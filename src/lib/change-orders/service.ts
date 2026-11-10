/**
 * Client change orders for callers that are not a browser session: the Penney
 * MCP (Claude / ChatGPT acting for a signed-in team member) through
 * POST /api/change-orders.
 *
 * It mirrors what the app's own buttons do (createChangeOrder /
 * updateChangeOrder in src/lib/actions/change-orders.ts and the Send button's
 * /api/send-change-order), so a change order written from chat is the same
 * record, with the same budget line, the same PDF and the same client email.
 * Rules that the buttons leave to the person are enforced here, because the
 * caller is an AI acting on someone's word:
 *   - a change order always gets its budget line, or it is not created;
 *   - a signed change order can't be edited or re-sent;
 *   - nothing is emailed without the PDF attached;
 *   - the email leaves from the acting person's own Gmail, never a teammate's.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { lineItemFinancials } from "@/lib/estimates/line-item-financials";
import { sendEmailWithAccessToken } from "@/lib/google/gmail";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { buildChangeOrderEmail, CHANGE_ORDER_INTERNAL_CC } from "./email";

export class ChangeOrderError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface ChangeOrderActor {
  profileId: string;
  name: string;
  email: string;
}

/** A change to a job that is not under contract yet is an estimate revision. */
const NOT_UNDER_CONTRACT = new Set(["lead", "estimating", "waiting_for_approval", "proposal_sent", "cancelled"]);

const CO_COLUMNS =
  "id, project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, notes, approval_token, sent_to_client_at, client_email, client_viewed_at, client_view_count, client_signed_at, client_signature, approved_at, created_at, updated_at";

interface ChangeOrderRow {
  id: string;
  project_id: string;
  estimate_id: string | null;
  change_order_number: number;
  title: string;
  description: string | null;
  status: string;
  cost_impact: number | string | null;
  price_impact: number | string | null;
  notes: string | null;
  approval_token: string | null;
  sent_to_client_at: string | null;
  client_email: string | null;
  client_viewed_at: string | null;
  client_view_count: number | null;
  client_signed_at: string | null;
  client_signature: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  project_number: string | null;
  status: string | null;
  contract_value: number | string | null;
  contract_locked_amount: number | string | null;
  customers:
    | { first_name: string | null; last_name: string | null; email: string | null }
    | { first_name: string | null; last_name: string | null; email: string | null }[]
    | null;
}

const isSigned = (co: ChangeOrderRow) => !!(co.client_signed_at || co.client_signature);

/** What the caller sees for one change order. Never includes the signing token. */
function present(co: ChangeOrderRow, origin: string) {
  return {
    id: co.id,
    number: co.change_order_number,
    title: co.title,
    description: co.description,
    status: co.status,
    cost_impact: Number(co.cost_impact ?? 0),
    price_impact: Number(co.price_impact ?? 0),
    notes: co.notes,
    sent_to_client_at: co.sent_to_client_at,
    sent_to: co.client_email,
    client_viewed_at: co.client_viewed_at,
    client_view_count: co.client_view_count ?? 0,
    signed: isSigned(co),
    client_signed_at: co.client_signed_at,
    created_at: co.created_at,
    updated_at: co.updated_at,
    // Opens for anyone signed in to the Penney app.
    native_pdf_url: `${origin}/api/generate-change-order?changeOrderId=${co.id}`,
  };
}

async function loadProject(admin: SupabaseClient, projectId: string): Promise<ProjectRow> {
  const { data } = await admin
    .from("projects")
    .select("id, name, project_number, status, contract_value, contract_locked_amount, customers(first_name, last_name, email)")
    .eq("id", projectId)
    .maybeSingle();
  if (!data) throw new ChangeOrderError("Project not found.", 404);
  return data as unknown as ProjectRow;
}

function customerOf(project: ProjectRow) {
  const c = Array.isArray(project.customers) ? project.customers[0] : project.customers;
  return c ?? null;
}

async function loadChangeOrder(admin: SupabaseClient, changeOrderId: string): Promise<ChangeOrderRow> {
  const { data } = await admin.from("change_orders").select(CO_COLUMNS).eq("id", changeOrderId).maybeSingle();
  if (!data) throw new ChangeOrderError("Change order not found.", 404);
  return data as ChangeOrderRow;
}

/** The job's contract and every change order on it, with where each one stands. */
export async function listChangeOrders(admin: SupabaseClient, projectId: string, origin: string) {
  const project = await loadProject(admin, projectId);
  const { data } = await admin
    .from("change_orders")
    .select(CO_COLUMNS)
    .eq("project_id", projectId)
    .order("change_order_number");
  const rows = (data ?? []) as ChangeOrderRow[];
  const customer = customerOf(project);

  const contract = Number(project.contract_locked_amount ?? project.contract_value ?? 0);
  const live = rows.filter((r) => r.status !== "void" && r.status !== "rejected");
  const approved = live.filter((r) => r.status === "approved");
  const open = live.filter((r) => r.status !== "approved");
  const sum = (list: ChangeOrderRow[]) =>
    Math.round(list.reduce((total, r) => total + Number(r.price_impact ?? 0), 0) * 100) / 100;

  return {
    project: {
      id: project.id,
      name: project.name,
      project_number: project.project_number,
      status: project.status,
      under_contract: !NOT_UNDER_CONTRACT.has(project.status ?? ""),
      contract_amount: contract,
      client_name: customer ? [customer.first_name, customer.last_name].filter(Boolean).join(" ") : null,
      client_email_on_file: !!customer?.email,
    },
    change_orders: rows.map((r) => present(r, origin)),
    totals: {
      approved_change_orders: sum(approved),
      not_yet_approved: sum(open),
      contract_with_approved_changes: Math.round((contract + sum(approved)) * 100) / 100,
    },
    project_url: `${origin}/projects/${project.id}?tab=finances`,
  };
}

export interface CreateChangeOrderInput {
  project_id: string;
  title: string;
  description?: string;
  trade?: string;
  cost_impact: number;
  price_impact: number;
  notes?: string;
}

/** Same markup arithmetic as the app's own change order form. */
const markupFor = (cost: number, price: number) => (cost > 0 ? Math.round((price / cost - 1) * 100) : 0);

/** Write a DRAFT change order and its budget line. Nothing is sent. */
export async function createChangeOrderDraft(
  admin: SupabaseClient,
  actor: ChangeOrderActor,
  input: CreateChangeOrderInput,
  origin: string,
) {
  const project = await loadProject(admin, input.project_id);
  if (NOT_UNDER_CONTRACT.has(project.status ?? "")) {
    throw new ChangeOrderError(
      `${project.name} is not under contract (status: ${project.status}). A change before the contract is signed is an estimate revision, not a change order.`,
    );
  }

  const { data: estimateId } = await admin.rpc("current_estimate_id", { p_project_id: project.id });
  if (!estimateId) {
    throw new ChangeOrderError(
      `${project.name} has no estimate to carry the change order's budget line, so it would never show in the job's budget. Flag this job to Jorge.`,
    );
  }

  // (project_id, change_order_number) is unique, so a second writer at the
  // same moment loses the insert; take the next number and try once more.
  let created: ChangeOrderRow | null = null;
  for (let attempt = 0; attempt < 2 && !created; attempt++) {
    const { data: last } = await admin
      .from("change_orders")
      .select("change_order_number")
      .eq("project_id", project.id)
      .order("change_order_number", { ascending: false })
      .limit(1);
    const nextNumber = (last?.[0]?.change_order_number ?? 0) + 1;
    const { data, error } = await admin
      .from("change_orders")
      .insert({
        project_id: project.id,
        estimate_id: estimateId as string,
        change_order_number: nextNumber,
        title: input.title,
        description: input.description || null,
        status: "draft",
        cost_impact: input.cost_impact,
        price_impact: input.price_impact,
        notes: input.notes || null,
        created_by: actor.profileId,
      })
      .select(CO_COLUMNS)
      .single();
    if (data) created = data as ChangeOrderRow;
    else if (error?.code !== "23505") throw new ChangeOrderError(error?.message ?? "The change order could not be saved.", 500);
  }
  if (!created) throw new ChangeOrderError("Another change order was being written at the same moment. Try again.", 409);

  const { error: lineError } = await admin.from("estimate_line_items").insert({
    estimate_id: estimateId as string,
    description: input.title,
    trade: input.trade || null,
    ...lineItemFinancials(input.cost_impact, markupFor(input.cost_impact, input.price_impact), input.price_impact),
    quantity: 1,
    unit: "LS",
    unit_cost: input.cost_impact,
    sort_order: 100 + created.change_order_number,
    change_order_id: created.id,
    is_visible_on_proposal: false,
    source: "manual",
  });
  if (lineError) {
    // A change order with no budget line is invisible in job costing. Undo it
    // rather than leave half a record behind.
    await admin.from("change_orders").delete().eq("id", created.id);
    throw new ChangeOrderError(`The change order's budget line could not be saved, so nothing was created: ${lineError.message}`, 500);
  }

  return {
    change_order: present(created, origin),
    created_by: actor.name,
    project: { id: project.id, name: project.name, project_number: project.project_number },
    next_step: "This is a draft. Nothing was sent to the client.",
    project_url: `${origin}/projects/${project.id}?tab=finances`,
  };
}

export interface UpdateChangeOrderInput {
  change_order_id: string;
  title?: string;
  description?: string;
  trade?: string;
  cost_impact?: number;
  price_impact?: number;
  notes?: string;
}

export interface ReconcileChangeOrderBudgetInput {
  project_id: string;
  change_order_id: string;
  line_id: string;
  request_id?: string;
  expected_change_order_fingerprint?: string;
  expected_line_fingerprint?: string;
  reason?: string;
  evidence_refs?: string[];
}

/** Repair derived tracking data only. The signed CO itself is never edited. */
export async function reconcileChangeOrderBudget(
  admin: SupabaseClient,
  actor: ChangeOrderActor,
  input: ReconcileChangeOrderBudgetInput,
  apply: boolean,
) {
  const { data, error } = await admin.rpc("reconcile_signed_change_order_budget", {
    p_actor_id: actor.profileId,
    p_project_id: input.project_id,
    p_change_order_id: input.change_order_id,
    p_line_id: input.line_id,
    p_apply: apply,
    p_request_id: input.request_id ?? null,
    p_expected_change_order_fingerprint: input.expected_change_order_fingerprint ?? null,
    p_expected_line_fingerprint: input.expected_line_fingerprint ?? null,
    p_reason: input.reason ?? null,
    p_evidence_refs: input.evidence_refs ?? null,
  });
  if (error) {
    throw new ChangeOrderError(error.message, error.code === "42501" ? 403 : error.code === "40001" ? 409 : 400);
  }
  return data;
}

/** Edit a change order the client has not signed. Keeps the budget line in step. */
export async function updateChangeOrderDraft(admin: SupabaseClient, input: UpdateChangeOrderInput, origin: string) {
  const co = await loadChangeOrder(admin, input.change_order_id);
  if (isSigned(co) || co.status === "approved") {
    throw new ChangeOrderError(
      `Change Order #${co.change_order_number} is already signed or approved and can't be edited. Write a new change order for the difference.`,
      409,
    );
  }
  if (co.status === "void" || co.status === "rejected") {
    throw new ChangeOrderError(`Change Order #${co.change_order_number} is ${co.status} and can't be edited.`, 409);
  }

  const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) changes.title = input.title;
  if (input.description !== undefined) changes.description = input.description || null;
  if (input.cost_impact !== undefined) changes.cost_impact = input.cost_impact;
  if (input.price_impact !== undefined) changes.price_impact = input.price_impact;
  if (input.notes !== undefined) changes.notes = input.notes || null;

  // The client can sign while an office edit is open. Compare the exact
  // version and unsigned markers in the UPDATE itself, not only above.
  let update = admin
    .from("change_orders")
    .update(changes)
    .eq("id", co.id)
    .eq("updated_at", co.updated_at)
    .eq("status", co.status)
    .is("client_signed_at", null);
  update = co.client_signature === null
    ? update.is("client_signature", null)
    : update.eq("client_signature", co.client_signature);
  const { data: updated, error } = await update.select(CO_COLUMNS).maybeSingle();
  if (error) throw new ChangeOrderError(error.message, 500);
  if (!updated) throw new ChangeOrderError("The change order changed or was signed while this edit was open. Reload it before trying again.", 409);
  const after = updated as ChangeOrderRow;

  // The budget line always mirrors the change order's current numbers.
  const cost = Number(after.cost_impact ?? 0);
  const price = Number(after.price_impact ?? 0);
  const line: Record<string, unknown> = {
    description: after.title,
    unit_cost: cost,
    ...lineItemFinancials(cost, markupFor(cost, price), price),
  };
  if (input.trade !== undefined) line.trade = input.trade || null;
  const { error: lineError } = await admin.from("estimate_line_items").update(line).eq("change_order_id", co.id);

  return {
    change_order: present(after, origin),
    ...(lineError ? { warning: `The change order saved but its budget line did not update: ${lineError.message}` } : {}),
    ...(co.sent_to_client_at
      ? { resend_needed: "The client already has the earlier version of this change order. Send it again so they sign the corrected one." }
      : {}),
  };
}

interface SendContext {
  co: ChangeOrderRow;
  project: ProjectRow;
  to: string;
  email: ReturnType<typeof buildChangeOrderEmail>;
}

async function prepareSend(admin: SupabaseClient, changeOrderId: string, origin: string): Promise<SendContext> {
  const co = await loadChangeOrder(admin, changeOrderId);
  if (co.status === "void" || co.status === "rejected") {
    throw new ChangeOrderError(`Change Order #${co.change_order_number} is ${co.status} and can't be sent.`, 409);
  }
  if (isSigned(co)) {
    throw new ChangeOrderError(`Change Order #${co.change_order_number} is already signed by the client. There is nothing to send.`, 409);
  }
  if (!co.approval_token) throw new ChangeOrderError("This change order has no signing link. Flag it to Jorge.", 500);
  const project = await loadProject(admin, co.project_id);
  const customer = customerOf(project);
  if (!customer?.email) {
    throw new ChangeOrderError("No email on file for this job's client. Add their email in the app first.");
  }
  const email = buildChangeOrderEmail({
    changeOrderNumber: co.change_order_number,
    title: co.title,
    priceImpact: Number(co.price_impact ?? 0),
    approvalToken: co.approval_token,
    projectName: project.name,
    clientFirstName: customer.first_name,
    origin,
  });
  return { co, project, to: customer.email, email };
}

async function fetchPdf(changeOrderId: string, origin: string): Promise<Buffer | null> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${origin}/api/generate-change-order?changeOrderId=${changeOrderId}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok || !res.headers.get("content-type")?.includes("pdf")) return null;
    const pdf = Buffer.from(await res.arrayBuffer());
    return pdf.subarray(0, 5).toString("latin1") === "%PDF-" ? pdf : null;
  } catch {
    return null;
  }
}

async function senderToken(admin: SupabaseClient, actor: ChangeOrderActor): Promise<string | null> {
  const { data } = await admin.from("profiles").select("google_refresh_token").eq("id", actor.profileId).maybeSingle();
  const refresh = (data?.google_refresh_token as string | null) ?? null;
  return refresh ? getAccessTokenFromRefreshToken(refresh) : null;
}

const NO_SENDER =
  "Your Google account is not connected to the Penney app, so the change order can't go out from your email. Sign out of the app and sign back in with Google, then try again.";

/**
 * Show exactly what the client would get, and check that it can actually go
 * out (the PDF renders, the sender's Gmail is connected). Sends nothing.
 */
export async function previewChangeOrderSend(
  admin: SupabaseClient,
  actor: ChangeOrderActor,
  changeOrderId: string,
  origin: string,
) {
  const ctx = await prepareSend(admin, changeOrderId, origin);
  const [pdf, token] = await Promise.all([fetchPdf(ctx.co.id, origin), senderToken(admin, actor)]);
  const blockers = [
    ...(pdf ? [] : ["The change order PDF could not be generated."]),
    ...(token ? [] : [NO_SENDER]),
  ];
  return {
    sent: false,
    ready_to_send: blockers.length === 0,
    blockers,
    email: {
      from: actor.email,
      to: ctx.to,
      cc: [...CHANGE_ORDER_INTERNAL_CC],
      subject: ctx.email.subject,
      body: ctx.email.body,
      attachment: pdf ? { filename: ctx.email.attachmentFilename, bytes: pdf.length } : null,
    },
    change_order: present(ctx.co, origin),
    ...(ctx.co.sent_to_client_at
      ? { already_sent_at: ctx.co.sent_to_client_at, note: "This change order was already sent once. Sending again emails the client a second time." }
      : {}),
    next_step: "Nothing was sent. Show the user this exact email and the PDF, and send only after they say yes.",
  };
}

/** Email the change order to the client for signature, from the actor's own Gmail. */
export async function sendChangeOrderToClient(
  admin: SupabaseClient,
  actor: ChangeOrderActor,
  changeOrderId: string,
  origin: string,
) {
  const ctx = await prepareSend(admin, changeOrderId, origin);
  const pdf = await fetchPdf(ctx.co.id, origin);
  if (!pdf) throw new ChangeOrderError("The change order PDF could not be generated, so nothing was sent. Try again.", 502);
  const token = await senderToken(admin, actor);
  if (!token) throw new ChangeOrderError(NO_SENDER, 409);

  let sent;
  try {
    sent = await sendEmailWithAccessToken(
      {
        to: ctx.to,
        cc: ctx.email.cc,
        subject: ctx.email.subject,
        body: ctx.email.body,
        attachments: [
          { filename: ctx.email.attachmentFilename, mimeType: "application/pdf", content: pdf.toString("base64") },
        ],
      },
      token,
    );
  } catch (err) {
    throw new ChangeOrderError(
      `Gmail refused the send, so the client did not get it: ${err instanceof Error ? err.message : String(err)}`.slice(0, 400),
      502,
    );
  }

  const sentAt = new Date().toISOString();
  const { data: updated, error: stampError } = await admin
    .from("change_orders")
    .update({
      sent_to_client_at: sentAt,
      client_email: ctx.to,
      status: ctx.co.status === "draft" ? "submitted" : ctx.co.status,
    })
    .eq("id", ctx.co.id)
    .select(CO_COLUMNS)
    .single();

  await admin.from("email_logs").insert({
    gmail_message_id: sent.id,
    subject: ctx.email.subject,
    from_email: actor.email,
    to_email: ctx.to,
    direction: "outbound",
    category: "client_update",
    project_id: ctx.co.project_id,
  });

  return {
    sent: true,
    gmail_message_id: sent.id,
    from: actor.email,
    to: ctx.to,
    cc: [...CHANGE_ORDER_INTERNAL_CC],
    subject: ctx.email.subject,
    attachment: ctx.email.attachmentFilename,
    change_order: present((updated as ChangeOrderRow | null) ?? { ...ctx.co, sent_to_client_at: sentAt, client_email: ctx.to }, origin),
    ...(stampError
      ? { warning: "The email went out, but the change order was not marked as sent in the app. Do NOT send it again; tell Jorge." }
      : {}),
    next_step: "The client signs from the link in the email. list_change_orders shows when they open it and when they sign.",
  };
}
