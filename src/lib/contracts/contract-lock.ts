// Shared contract-money helpers. Deliberately NOT a "use server" module —
// these take a Supabase client and are called from both server actions and
// route handlers (including the service-role public signing route).

import { PAYMENT_PRESETS } from "@/lib/constants/payment-schedule";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentEstimate } from "@/lib/estimates/current-estimate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = SupabaseClient<any, any, any>;

export const cents = (v: number) => Math.round(v * 100) / 100;

/**
 * The contract price, resolved the same way /api/generate-contract resolves it
 * so the PDF, the tile, and the DB never disagree.
 *
 * Once the contract is locked, the frozen number wins outright — that is the
 * whole point of locking. Before that it is the live sum of the visible
 * estimate lines, falling back to whatever money the project has on it.
 */
export async function resolveContractTotal(
  supabase: DB,
  projectId: string,
): Promise<{ total: number; locked: boolean }> {
  const { data: project } = await supabase
    .from("projects")
    .select("contract_value, estimated_value, contract_locked_amount, contract_locked_at")
    .eq("id", projectId)
    .single();

  if (project?.contract_locked_at && project.contract_locked_amount != null) {
    return { total: Number(project.contract_locked_amount), locked: true };
  }

  const estimate = await getCurrentEstimate<{ id: string; total_price: number | null }>(
    supabase,
    projectId,
    "id, total_price"
  );

  if (estimate?.id) {
    // Sum the lines the client actually sees, exactly like the contract PDF.
    const { data: lines } = await supabase
      .from("estimate_line_items")
      .select("total_price, client_price, is_visible_on_proposal, is_section_header")
      .eq("estimate_id", estimate.id);
    const visible = (lines ?? []).filter(
      (li) => li.is_visible_on_proposal !== false && !li.is_section_header,
    );
    const sum = visible.reduce((s, li) => s + Number(li.client_price ?? li.total_price ?? 0), 0);
    if (sum > 0) return { total: cents(sum), locked: false };
    if (Number(estimate.total_price) > 0) return { total: Number(estimate.total_price), locked: false };
  }

  const fallback = Number(project?.contract_value ?? 0) || Number(project?.estimated_value ?? 0);
  return { total: cents(fallback), locked: false };
}

/**
 * Seed the standard thirds schedule when a project has none.
 *
 * /api/generate-contract has always PRINTED a thirds split when there were no
 * milestone rows, without saving it — so a client could be holding a contract
 * with a payment schedule the app had no record of, and none of those payments
 * could be one-click invoiced. Sending a contract now persists what it prints.
 *
 * No-op when a schedule already exists.
 */
export async function ensureDefaultPaymentSchedule(
  supabase: DB,
  projectId: string,
): Promise<{ seeded: boolean; error: string | null }> {
  const { count, error: countError } = await supabase
    .from("project_payment_milestones")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (countError) return { seeded: false, error: countError.message };
  if ((count ?? 0) > 0) return { seeded: false, error: null };

  const thirds = PAYMENT_PRESETS.find((p) => p.key === "thirds");
  if (!thirds) return { seeded: false, error: "Thirds preset missing" };

  const { error } = await supabase.from("project_payment_milestones").insert(
    thirds.rows.map((r, i) => ({
      project_id: projectId,
      sort_order: (i + 1) * 10,
      label: r.label,
      stage_key: r.stage_key,
      percent: r.percent,
      amount: null,
    })),
  );
  if (error) return { seeded: false, error: error.message };
  return { seeded: true, error: null };
}

export interface LockResult {
  lockedAmount: number;
  milestonesFrozen: number;
  invoicesCreated: number;
  paymentsMatched: number;
}

/**
 * Everything that happens the moment a contract is fully executed.
 *
 * 1. Freeze the price. contract_locked_at is what makes the estimate-sync
 *    trigger (00107) stop rewriting contract_value — from here on, repricing
 *    goes through a change order.
 * 2. Convert every percent milestone to a fixed dollar amount off the frozen
 *    number, rounding cents into the last row so the schedule sums exactly.
 *    A percentage of a moving target is not a payment schedule.
 * 3. Premake one DRAFT client invoice per milestone, so the Invoices tile is
 *    populated the day the contract is signed instead of after somebody
 *    remembers to click "Create invoice" three separate times. QuickBooks is
 *    deliberately deferred to send time.
 * 4. Reconcile deposits already in hand — only on an exact dollar match.
 */
export async function lockContractAndPremakeInvoices(
  supabase: DB,
  projectId: string,
): Promise<{ data?: LockResult; error?: string }> {
  const { total } = await resolveContractTotal(supabase, projectId);
  if (!total || total <= 0) {
    return { error: "No contract value to lock — the project has no priced estimate." };
  }

  const seed = await ensureDefaultPaymentSchedule(supabase, projectId);
  if (seed.error) return { error: seed.error };

  const { data: milestones, error: mErr } = await supabase
    .from("project_payment_milestones")
    .select("id, sort_order, label, percent, amount, status, client_invoice_id")
    .eq("project_id", projectId)
    .order("sort_order");
  if (mErr) return { error: mErr.message };

  const rows = milestones ?? [];

  // ── 2. Freeze percentages into dollars ──
  const resolved = rows.map((m) => ({
    ...m,
    dollars: m.amount != null ? Number(m.amount) : cents((total * Number(m.percent ?? 0)) / 100),
  }));
  const allPercent = rows.length > 0 && rows.every((m) => m.amount == null);
  const pctSum = rows.reduce((s, m) => s + Number(m.percent ?? 0), 0);
  if (allPercent && Math.abs(pctSum - 100) < 0.05 && resolved.length > 0) {
    const sum = resolved.reduce((s, r) => s + r.dollars, 0);
    const last = resolved[resolved.length - 1];
    last.dollars = cents(last.dollars + (total - sum));
  }

  let milestonesFrozen = 0;
  for (const m of resolved) {
    if (m.amount != null) continue;
    const { error } = await supabase
      .from("project_payment_milestones")
      .update({ amount: m.dollars, percent: null, updated_at: new Date().toISOString() })
      .eq("id", m.id)
      .eq("project_id", projectId);
    if (error) return { error: error.message };
    milestonesFrozen += 1;
  }

  // ── 3. Premake a draft invoice per milestone ──
  // Inserted directly rather than through createClientInvoice: the client
  // signs on a public, unauthenticated route, and that server action requires
  // a logged-in user. Attribution falls back to whoever put Penney's
  // signature on the contract. QuickBooks is deliberately skipped — these are
  // drafts, and /api/send-client-invoice pushes on send.
  const { data: attribution } = await supabase
    .from("projects")
    .select("contract_countersigned_by, created_by")
    .eq("id", projectId)
    .single();
  const createdBy = attribution?.contract_countersigned_by ?? attribution?.created_by ?? null;

  const { data: lastInvoice } = await supabase
    .from("client_invoices")
    .select("invoice_number")
    .eq("project_id", projectId)
    .order("invoice_number", { ascending: false })
    .limit(1);
  let nextInvoiceNumber = (lastInvoice?.[0]?.invoice_number ?? 0) + 1;

  let invoicesCreated = 0;
  const createdInvoices: { id: string; amount: number }[] = [];
  for (const m of resolved) {
    if (m.client_invoice_id) continue;
    if (m.dollars <= 0) continue;

    const { data: invoice, error: invErr } = await supabase
      .from("client_invoices")
      .insert({
        project_id: projectId,
        invoice_number: nextInvoiceNumber,
        title: m.label,
        description: "Progress payment per the contract payment schedule.",
        line_items: [{ description: m.label, amount: m.dollars }],
        amount: m.dollars,
        terms: "Due within 5 days of invoice",
        status: "draft",
        created_by: createdBy,
      })
      .select("id")
      .single();
    if (invErr) return { error: invErr.message };
    const invoiceId = invoice?.id ?? null;
    if (!invoiceId) return { error: "Invoice was not created" };
    nextInvoiceNumber += 1;

    const { error: linkErr } = await supabase
      .from("project_payment_milestones")
      .update({
        status: "scheduled",
        client_invoice_id: invoiceId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", m.id)
      .eq("project_id", projectId);
    if (linkErr) return { error: linkErr.message };

    createdInvoices.push({ id: invoiceId, amount: m.dollars });
    invoicesCreated += 1;
  }

  // ── 4. Reconcile money already received ──
  // Only an exact dollar match counts. A deposit of $17,861.67 against a
  // $17,861.67 milestone is bookkeeping; anything looser is a guess, and a
  // wrong guess here corrupts the job's financials.
  let paymentsMatched = 0;
  if (createdInvoices.length > 0) {
    const { data: payments } = await supabase
      .from("payments_received")
      .select("id, amount, received_date")
      .eq("project_id", projectId)
      .order("received_date");

    const unmatched = [...(payments ?? [])];
    for (const inv of createdInvoices) {
      const hit = unmatched.findIndex((p) => Math.abs(Number(p.amount) - inv.amount) < 0.01);
      if (hit === -1) continue;
      const [payment] = unmatched.splice(hit, 1);
      const { error } = await supabase
        .from("client_invoices")
        .update({
          status: "paid",
          paid_at: payment.received_date ?? new Date().toISOString(),
          paid_amount: inv.amount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inv.id);
      if (error) return { error: error.message };
      await supabase
        .from("project_payment_milestones")
        .update({ status: "paid", updated_at: new Date().toISOString() })
        .eq("client_invoice_id", inv.id)
        .eq("project_id", projectId);
      paymentsMatched += 1;
    }
  }

  // ── 1. Freeze the price (last, so a failure above leaves it unlocked) ──
  const { error: lockErr } = await supabase
    .from("projects")
    .update({
      contract_locked_amount: total,
      contract_locked_at: new Date().toISOString(),
      contract_value: total,
      contract_status: "signed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);
  if (lockErr) return { error: lockErr.message };

  return {
    data: { lockedAmount: total, milestonesFrozen, invoicesCreated, paymentsMatched },
  };
}
