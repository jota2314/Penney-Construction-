"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/get-user";
import { SUB_AGREEMENT_SIGNER_NAMES, canSignSubAgreements } from "@/lib/auth/role-access";
import { roundCents } from "@/lib/money";
import { notifySubAgreementSigned } from "@/lib/notifications/sub-field-notify";
import { sha256Hex } from "@/lib/pdf/penney-doc";
import { etDate, isCalendarDay, todayET } from "@/lib/sub-portal/et-day";
import { hasFillInBlank, isAwaitingSubSignature, type SubAgreementStatus } from "@/lib/sub-portal/statuses";
import type { SubAgreementDraw, SubAgreementKind, SubAgreementSection, SubPriceBasis } from "@/lib/sub-portal/payload";
import { createAdminClient } from "@/lib/supabase/admin";
import { AGREEMENT_KIND_LABEL, agreementAmount, countFillIns, isTestSubName } from "@/lib/subs/agreement-format";
import { renderAgreementPdf } from "@/lib/subs/agreement-pdf";
import {
  SUB_DOCUMENTS_BUCKET,
  agreementPdfUrl,
  findCurrentMaster,
  isAgreementOfficeRole,
  loadAgreementBundle,
  loadAgreementRow,
  loadSignerIdentity,
  loadTemplate,
  loadWorkOrderAutofill,
  nextChangeOrderNumber,
  nextMasterNumber,
  nextWorkOrderNumber,
  paperScanPath,
  pickTemplate,
  sendBlockers,
  sentPdfPath,
  storeFile,
  templateHasBlanks,
  templateUsableFor,
  toDraws,
  toSections,
  type AgreementBundle,
  type AgreementRow,
  type TemplateRow,
} from "@/lib/subs/agreements";
import type { AuthUser } from "@/types/auth";

/**
 * Server actions for sub agreements (plan §5 + ADDENDUM 2).
 *
 * Who does what:
 *  - Office roles draft and edit work orders (draftWorkOrder,
 *    draftQuickWorkOrder, draftSubChangeOrder, updateDraftAgreement) and
 *    void drafts that never went out.
 *  - Ryan alone (canSignSubAgreements: his real login, never while
 *    impersonating) signs for Penney, sends, files a paper-signed copy, voids
 *    anything that went out, and approves the template text.
 * Every write uses the service role: the agreement tables are office-read
 * only by RLS. Nothing here emails or texts anyone; a sent agreement shows
 * up in the sub's portal "Needed from you" list.
 */

type Admin = ReturnType<typeof createAdminClient>;
type Result<T> = { error: string; data?: undefined } | { error: null; data: T };

const fail = <T>(error: string): Result<T> => ({ error });
const ok = <T>(data: T): Result<T> => ({ error: null, data });

// ───────────────────────────────────────── who is asking

async function requireOffice(): Promise<{ user: AuthUser; actorId: string } | { error: string }> {
  const user = await getUser();
  if (!user) return { error: "Not signed in" };
  if (!isAgreementOfficeRole(user.profile?.role)) return { error: "Only office staff can work on sub agreements" };
  return { user, actorId: user.realProfile?.id ?? user.id };
}

async function requireSigner(what: string): Promise<{ user: AuthUser; profile: NonNullable<AuthUser["realProfile"]> } | { error: string }> {
  const user = await getUser();
  if (!user) return { error: "Not signed in" };
  if (user.isImpersonating) return { error: `Stop viewing as someone else first. Only ${SUB_AGREEMENT_SIGNER_NAMES} can ${what}.` };
  if (!canSignSubAgreements(user) || !user.realProfile) return { error: `Only ${SUB_AGREEMENT_SIGNER_NAMES} can ${what}.` };
  return { user, profile: user.realProfile };
}

/** Template editing (the words, before approval): owners and precon. Approving is Ryan only. */
async function requireTemplateEditor(): Promise<{ user: AuthUser; actorId: string } | { error: string }> {
  const user = await getUser();
  if (!user) return { error: "Not signed in" };
  if (!["owner", "precon_manager"].includes(user.profile?.role ?? "")) return { error: "Only an owner or Jorge can edit the agreement text" };
  return { user, actorId: user.realProfile?.id ?? user.id };
}

function revalidateAgreement(projectId: string | null | undefined) {
  if (projectId) revalidatePath(`/projects/${projectId}`);
  revalidatePath("/subcontractors/agreements");
}

/** Insert with a fresh number; a race on the unique number retries with the next one. */
async function insertAgreement(
  admin: Admin,
  row: Record<string, unknown>,
  makeNumber: () => Promise<string>,
): Promise<Result<{ id: string; number: string }>> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const number = await makeNumber();
    const { data, error } = await admin.from("sub_agreements").insert({ ...row, number }).select("id, number").single();
    if (!error && data) return ok(data as { id: string; number: string });
    if (error?.code !== "23505") return fail(error?.message ?? "Couldn't save the agreement");
  }
  return fail("Couldn't pick a free agreement number. Try again.");
}

/**
 * A work order's master is stale when it is missing, voided or replaced, or
 * from an earlier ET year: a master covers the work orders issued in the year
 * on its page one ("Covers: Work orders issued in 2026").
 */
function masterIsStale(master: AgreementRow | null, year = todayET().slice(0, 4)): boolean {
  return !master || master.status === "void" || master.status === "superseded" || !(etDate(master.created_at) ?? "").startsWith(year);
}

/**
 * His other live work orders on this job that already carry one of this work
 * order's quotes or awarded estimate lines. Signing both would count them
 * twice when sync_sub_contract sums the signed work orders.
 */
async function overlappingWorkOrders(admin: Admin, a: AgreementRow): Promise<string[]> {
  if (a.kind !== "work_order" || !a.project_id) return [];
  const checks: { col: "quote_request_ids" | "estimate_line_item_ids"; ids: string[] }[] = [
    { col: "quote_request_ids", ids: a.quote_request_ids },
    { col: "estimate_line_item_ids", ids: a.estimate_line_item_ids },
  ];
  const numbers = new Set<string>();
  for (const { col, ids } of checks) {
    if (!ids.length) continue;
    const { data } = await admin
      .from("sub_agreements")
      .select("number")
      .eq("project_id", a.project_id)
      .eq("subcontractor_id", a.subcontractor_id)
      .eq("kind", "work_order")
      .neq("id", a.id)
      .not("status", "in", "(void,superseded)")
      .overlaps(col, ids);
    for (const r of data ?? []) numbers.add(r.number as string);
  }
  return Array.from(numbers);
}

function overlapMessage(numbers: string[]): string {
  return `His quote or awarded line is already on ${numbers.join(", ")}. Void one of them, or use a sub change order for added work.`;
}

/** Another change order on the same work order still out for his signature (its sent copy is already rendered). */
function openSiblingMessage(numbers: string[]): string {
  return `${numbers.join(", ")} on this work order ${numbers.length === 1 ? "is" : "are"} still out for signature. Get ${numbers.length === 1 ? "it" : "them"} signed or void ${numbers.length === 1 ? "it" : "them"} first, so this one shows the right revised total.`;
}

// ───────────────────────────────────────── drafting

export interface DraftResult {
  id: string;
  number: string;
  /** Where the auto-filled fields came from, for the office to check. */
  sources: string[];
}

async function loadJobAndSub(admin: Admin, projectId: string, subId: string) {
  const [{ data: project }, { data: sub }] = await Promise.all([
    admin.from("projects").select("id, name, project_number").eq("id", projectId).maybeSingle(),
    admin.from("subcontractors").select("id, company_name").eq("id", subId).maybeSingle(),
  ]);
  return {
    project: project as { id: string; name: string; project_number: string | null } | null,
    sub: sub as { id: string; company_name: string } | null,
  };
}

/**
 * A work order drafted from what is already agreed (plan §5.3): his accepted
 * quotes' scope word for word and their summed price, his phase dates, the
 * job's owner/association terms. The office checks every field before Ryan
 * signs. No AI writes anything here.
 */
export async function draftWorkOrder(input: { projectId: string; subId: string }): Promise<Result<DraftResult>> {
  const auth = await requireOffice();
  if ("error" in auth) return fail(auth.error);
  const admin = createAdminClient();
  const { project, sub } = await loadJobAndSub(admin, input.projectId, input.subId);
  if (!project) return fail("Job not found");
  if (!sub) return fail("Sub not found");

  const isTest = isTestSubName(sub.company_name);
  const [fill, template, master] = await Promise.all([
    loadWorkOrderAutofill(admin, project.id, sub.id),
    pickTemplate(admin, "work_order", isTest),
    findCurrentMaster(admin, sub.id),
  ]);
  if (!template) return fail("There is no work order template. Add one on Subcontractors, Agreements.");

  const res = await insertAgreement(
    admin,
    {
      kind: "work_order",
      subcontractor_id: sub.id,
      project_id: project.id,
      master_id: master?.id ?? null,
      template_id: template.id,
      scope_text: fill.scope_text,
      exclusions_text: fill.exclusions_text,
      price_basis: fill.price_basis,
      price: fill.price,
      draws: fill.draws,
      start_date: fill.start_date,
      end_date: fill.end_date,
      schedule_phase_ids: fill.schedule_phase_ids,
      quote_request_ids: fill.quote_request_ids,
      estimate_line_item_ids: fill.estimate_line_item_ids,
      additional_terms: fill.additional_terms,
      status: "draft",
      created_by: auth.actorId,
    },
    () => nextWorkOrderNumber(admin, project),
  );
  if (res.error !== null) return fail(res.error);
  revalidateAgreement(project.id);
  return ok({ ...res.data, sources: fill.sources });
}

/**
 * The quick work order (plan §5.1): a time-and-material rate, a
 * not-to-exceed and a short scope ("Demo per Ryan"). This is how work that
 * was never quoted or awarded (Marcio's Pedersen demo) gets a record.
 */
export async function draftQuickWorkOrder(input: {
  projectId: string;
  subId: string;
  rate: number | null;
  unitLabel?: string | null;
  notToExceed: number | null;
  scope: string;
}): Promise<Result<DraftResult>> {
  const auth = await requireOffice();
  if ("error" in auth) return fail(auth.error);
  const rate = input.rate == null ? null : roundCents(input.rate);
  const nte = input.notToExceed == null ? null : roundCents(input.notToExceed);
  const scope = input.scope.trim();
  if (!scope) return fail("Write a short scope, e.g. \"Demo per Ryan\"");
  if (rate == null || rate <= 0) return fail("Enter the hourly rate");
  if (nte == null || nte <= 0) return fail("Enter the not-to-exceed amount");
  if (nte < rate) return fail("The not-to-exceed is less than one hour");

  const admin = createAdminClient();
  const { project, sub } = await loadJobAndSub(admin, input.projectId, input.subId);
  if (!project) return fail("Job not found");
  if (!sub) return fail("Sub not found");
  const isTest = isTestSubName(sub.company_name);
  const [fill, template, master] = await Promise.all([
    loadWorkOrderAutofill(admin, project.id, sub.id),
    pickTemplate(admin, "work_order", isTest),
    findCurrentMaster(admin, sub.id),
  ]);
  if (!template) return fail("There is no work order template. Add one on Subcontractors, Agreements.");

  const res = await insertAgreement(
    admin,
    {
      kind: "work_order",
      subcontractor_id: sub.id,
      project_id: project.id,
      master_id: master?.id ?? null,
      template_id: template.id,
      scope_text: scope,
      price_basis: "time_and_material",
      price: null,
      unit_rate: rate,
      unit_label: input.unitLabel?.trim() || "hour",
      not_to_exceed: nte,
      draws: [{ label: "Each week", amount: null, percent: null, when: "For the hours on his daily portal logs that week" }],
      start_date: fill.start_date,
      end_date: fill.end_date,
      schedule_phase_ids: fill.schedule_phase_ids,
      additional_terms: fill.additional_terms,
      status: "draft",
      created_by: auth.actorId,
    },
    () => nextWorkOrderNumber(admin, project),
  );
  if (res.error !== null) return fail(res.error);
  revalidateAgreement(project.id);
  return ok({ ...res.data, sources: ["Quick work order: time and material with a not-to-exceed.", ...fill.sources.filter((s) => s.startsWith("Dates") || s.startsWith("Owner"))] });
}

/**
 * A sub change order against a signed work order: what changes and the
 * amount (negative = a credit to Penney). This is the path the lock refusal
 * points to ("Locked by WO-046-01; use a sub change order").
 */
export async function draftSubChangeOrder(input: { parentId: string; scope: string; price: number | null }): Promise<Result<DraftResult>> {
  const auth = await requireOffice();
  if ("error" in auth) return fail(auth.error);
  const scope = input.scope.trim();
  if (!scope) return fail("Write what changes");
  if (input.price == null || !Number.isFinite(input.price) || input.price === 0) return fail("Enter the amount (a negative number is a credit)");

  const admin = createAdminClient();
  const parent = await loadAgreementBundle(admin, input.parentId);
  if (!parent || parent.agreement.kind !== "work_order") return fail("Work order not found");
  if (parent.agreement.status !== "signed") return fail(`${parent.agreement.number} isn't signed yet. Change the draft instead.`);
  const template = await pickTemplate(admin, "change_order", parent.isTestSub);
  if (!template) return fail("There is no sub change order template. Add one on Subcontractors, Agreements.");

  const res = await insertAgreement(
    admin,
    {
      kind: "change_order",
      subcontractor_id: parent.agreement.subcontractor_id,
      project_id: parent.agreement.project_id,
      master_id: parent.agreement.master_id,
      parent_id: parent.agreement.id,
      template_id: template.id,
      scope_text: scope,
      price_basis: "lump_sum",
      price: roundCents(input.price),
      draws: [{ label: "With the work order payments", amount: roundCents(input.price), percent: null, when: null }],
      status: "draft",
      created_by: auth.actorId,
    },
    () => nextChangeOrderNumber(admin, parent.agreement),
  );
  if (res.error !== null) return fail(res.error);
  revalidateAgreement(parent.agreement.project_id);
  return ok({ ...res.data, sources: [] });
}

export interface AgreementDraftPatch {
  scope_text?: string | null;
  exclusions_text?: string | null;
  price_basis?: SubPriceBasis | null;
  price?: number | null;
  unit_rate?: number | null;
  unit_label?: string | null;
  not_to_exceed?: number | null;
  draws?: SubAgreementDraw[];
  start_date?: string | null;
  end_date?: string | null;
  additional_terms?: SubAgreementSection[];
}

const PRICE_BASES: SubPriceBasis[] = ["lump_sum", "unit", "time_and_material"];

/**
 * Edit a draft (plan's updateDraft). If Ryan had already signed it for
 * Penney, his signature comes off: he never signed the edited words.
 */
export async function updateDraftAgreement(id: string, patch: AgreementDraftPatch): Promise<Result<{ penneySignatureCleared: boolean }>> {
  const auth = await requireOffice();
  if ("error" in auth) return fail(auth.error);
  const admin = createAdminClient();
  const { data: row } = await admin.from("sub_agreements").select("id, status, project_id, penney_signed_at, kind").eq("id", id).maybeSingle();
  if (!row) return fail("Agreement not found");
  if (row.status !== "draft") return fail("Only a draft can be changed. Use a sub change order for a signed work order.");

  const update: Record<string, unknown> = {};
  const text = (v: string | null | undefined) => (v == null ? null : v.replace(/\r\n?/g, "\n").trim() || null);
  const money = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : roundCents(v));
  if ("scope_text" in patch) update.scope_text = text(patch.scope_text);
  if ("exclusions_text" in patch) update.exclusions_text = text(patch.exclusions_text);
  if ("price_basis" in patch) {
    if (patch.price_basis != null && !PRICE_BASES.includes(patch.price_basis)) return fail("Unknown price basis");
    update.price_basis = patch.price_basis ?? null;
  }
  if ("price" in patch) update.price = money(patch.price);
  if ("unit_rate" in patch) update.unit_rate = money(patch.unit_rate);
  if ("unit_label" in patch) update.unit_label = text(patch.unit_label);
  if ("not_to_exceed" in patch) update.not_to_exceed = money(patch.not_to_exceed);
  if ("draws" in patch) update.draws = toDraws(patch.draws).map((d) => ({ ...d, amount: d.amount == null ? null : roundCents(d.amount) }));
  // A change order's one payment is its amount; its editor never shows the
  // payments, so they follow the amount here.
  if (row.kind === "change_order" && typeof update.price === "number") {
    update.draws = [{ label: "With the work order payments", amount: update.price, percent: null, when: null }];
  }
  if ("additional_terms" in patch) update.additional_terms = toSections(patch.additional_terms);
  for (const key of ["start_date", "end_date"] as const) {
    if (key in patch) {
      const v = patch[key];
      if (v != null && v !== "" && !isCalendarDay(v)) return fail("Dates must be YYYY-MM-DD");
      update[key] = v || null;
    }
  }
  const start = (update.start_date as string | null | undefined) ?? undefined;
  const end = (update.end_date as string | null | undefined) ?? undefined;
  if (start && end && end < start) return fail("The finish date is before the start date");
  if (row.kind !== "change_order" && typeof update.price === "number" && update.price < 0) return fail("A work order price can't be negative");

  if (Object.keys(update).length === 0) return ok({ penneySignatureCleared: false });
  // Any edit takes Penney's signature and the sent-copy hash off in the same
  // write, even if Ryan signed between the read above and this update: he
  // never signed the edited words. On an unsigned draft this changes nothing.
  const cleared = !!row.penney_signed_at;
  Object.assign(update, { penney_signer_id: null, penney_signed_name: null, penney_signed_title: null, penney_signed_at: null, pdf_sha256: null });

  const { data: saved, error } = await admin.from("sub_agreements").update(update).eq("id", id).eq("status", "draft").select("id").maybeSingle();
  if (error) return fail(error.message);
  if (!saved) return fail("It was sent while you were editing. Reload.");
  revalidateAgreement(row.project_id);
  return ok({ penneySignatureCleared: cleared });
}

// ───────────────────────────────────────── reading (office)

export interface OfficeAgreementRow {
  id: string;
  number: string;
  kind: SubAgreementKind;
  status: SubAgreementStatus;
  subcontractor_id: string;
  sub_name: string;
  parent_id: string | null;
  price_basis: SubPriceBasis | null;
  amount: number | null;
  scope_text: string | null;
  penney_signed_at: string | null;
  sent_at: string | null;
  first_viewed_at: string | null;
  sub_signed_at: string | null;
  signed_on_paper: boolean;
  created_at: string;
}

export interface ProjectAgreementsData {
  agreements: OfficeAgreementRow[];
  /** Subs with any link to this job (quotes, phases, job link, agreements), for the picker's top group. */
  onJobSubIds: string[];
  /** Subs with a portal login (Send needs one). */
  portalSubIds: string[];
  viewer: { canSign: boolean };
}

export async function getProjectAgreements(projectId: string): Promise<Result<ProjectAgreementsData>> {
  const auth = await requireOffice();
  if ("error" in auth) return fail(auth.error);
  const admin = createAdminClient();
  const [agRes, quotesRes, phasesRes, linksRes] = await Promise.all([
    admin
      .from("sub_agreements")
      .select("id, number, kind, status, subcontractor_id, parent_id, price_basis, price, not_to_exceed, scope_text, penney_signed_at, sent_at, first_viewed_at, sub_signed_at, signed_on_paper, created_at, subcontractors(company_name)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    admin.from("quote_requests").select("subcontractor_id").eq("project_id", projectId).not("subcontractor_id", "is", null),
    admin.from("schedule_phases").select("assigned_sub_ids").eq("project_id", projectId),
    admin.from("project_subcontractors").select("subcontractor_id").eq("project_id", projectId),
  ]);
  const agreements: OfficeAgreementRow[] = (agRes.data ?? []).map((r) => {
    const subRel = Array.isArray(r.subcontractors) ? r.subcontractors[0] : r.subcontractors;
    return {
      id: r.id,
      number: r.number,
      kind: r.kind,
      status: r.status,
      subcontractor_id: r.subcontractor_id,
      sub_name: (subRel as { company_name?: string } | null)?.company_name ?? "Sub",
      parent_id: r.parent_id,
      price_basis: r.price_basis,
      amount: agreementAmount({
        price_basis: r.price_basis,
        price: r.price == null ? null : Number(r.price),
        not_to_exceed: r.not_to_exceed == null ? null : Number(r.not_to_exceed),
        unit_rate: null,
        unit_label: null,
      }),
      scope_text: r.scope_text,
      penney_signed_at: r.penney_signed_at,
      sent_at: r.sent_at,
      first_viewed_at: r.first_viewed_at,
      sub_signed_at: r.sub_signed_at,
      signed_on_paper: !!r.signed_on_paper,
      created_at: r.created_at,
    };
  });
  const ids = new Set<string>();
  for (const q of quotesRes.data ?? []) if (q.subcontractor_id) ids.add(q.subcontractor_id);
  for (const p of phasesRes.data ?? []) for (const s of (p.assigned_sub_ids ?? []) as string[]) if (s) ids.add(s);
  for (const l of linksRes.data ?? []) if (l.subcontractor_id) ids.add(l.subcontractor_id);
  for (const a of agreements) ids.add(a.subcontractor_id);

  const { data: access } = ids.size
    ? await admin.from("sub_portal_access").select("subcontractor_id").eq("enabled", true).in("subcontractor_id", Array.from(ids))
    : { data: [] as { subcontractor_id: string }[] };

  return ok({
    agreements,
    onJobSubIds: Array.from(ids),
    portalSubIds: Array.from(new Set((access ?? []).map((a) => a.subcontractor_id))),
    viewer: { canSign: canSignSubAgreements(auth.user) },
  });
}

export interface AgreementEditorData {
  agreement: Omit<AgreementRow, "sub_signed_ip" | "sub_signed_ua" | "sub_signed_access_id" | "sub_signed_worker_id" | "sub_signed_phone">;
  sub: { id: string; company_name: string; contact_name: string | null; has_portal: boolean; is_test: boolean };
  project: { id: string; name: string; project_number: string | null } | null;
  template: { id: string; kind: SubAgreementKind; version: number; title: string; status: TemplateRow["status"]; test_only: boolean; blanks: number };
  master: { id: string; number: string; status: SubAgreementStatus } | null;
  parent: { id: string; number: string } | null;
  /** Every owner/association term on the job, ticked when this agreement carries it. */
  flow_down_options: (SubAgreementSection & { checked: boolean })[];
  sources: string[];
  /** Why Ryan can't sign and send it yet (empty = ready). */
  blockers: string[];
  change_orders: { id: string; number: string; status: SubAgreementStatus; amount: number | null }[];
  viewer: { can_sign: boolean };
  pdf_url: string;
}

export async function getAgreementEditor(id: string): Promise<Result<AgreementEditorData>> {
  const auth = await requireOffice();
  if ("error" in auth) return fail(auth.error);
  const admin = createAdminClient();
  const b = await loadAgreementBundle(admin, id);
  if (!b) return fail("Agreement not found");
  const a = b.agreement;

  // The blockers Ryan's "Sign and send" will hit: an unapproved template is
  // swapped for the approved one at signing, so it only blocks when none exists.
  const blockers = sendBlockers(b).filter((m) => !m.includes("template isn't approved") && !m.includes("template still has"));
  if (a.status === "draft" && (!templateUsableFor(b.template, b.isTestSub) || templateHasBlanks(b.template))) {
    const approved = await pickTemplate(admin, a.kind, b.isTestSub, { approvedOnly: true });
    if (!approved) blockers.unshift(`The ${AGREEMENT_KIND_LABEL[a.kind].toLowerCase()} template isn't approved yet. Ryan approves it on Subcontractors, Agreements.`);
  }
  // Signing attaches this year's master (made then if he has none), so an
  // approved master template is needed when the attached one won't do.
  if (a.status === "draft" && a.kind === "work_order" && !a.penney_signed_at && masterIsStale(b.master)) {
    const current = await findCurrentMaster(admin, b.sub.id);
    const approvedMaster = current ? null : await pickTemplate(admin, "master", b.isTestSub, { approvedOnly: true });
    if (!current && !approvedMaster) blockers.push("The master agreement template isn't approved yet (it goes out with his first work order this year).");
  }
  if (a.status === "draft" && a.kind === "work_order") {
    const overlap = await overlappingWorkOrders(admin, a);
    if (overlap.length) blockers.push(overlapMessage(overlap));
  }

  let sources: string[] = [];
  let options: AgreementEditorData["flow_down_options"] = [];
  if (a.project_id && a.kind === "work_order") {
    const fill = await loadWorkOrderAutofill(admin, a.project_id, a.subcontractor_id, { excludeAgreementId: a.id });
    sources = fill.sources;
    // Drafted from awarded estimate lines: make sure no client number slipped in.
    if (a.estimate_line_item_ids.length && !a.quote_request_ids.length && /\$\s?\d|allowance/i.test(`${a.scope_text ?? ""}\n${a.exclusions_text ?? ""}`)) {
      sources = [...sources, "Scope mentions a dollar amount or an allowance. Make sure it isn't the client's number."];
    }
    const carried = new Set(a.additional_terms.map((t) => `${t.title}\n${t.body}`));
    options = fill.flow_down_options.map((o) => ({ title: o.title, body: o.body, checked: carried.has(`${o.title}\n${o.body}`) }));
    // Terms typed on this agreement that aren't on the job any more still show, ticked.
    for (const t of a.additional_terms) {
      if (!options.some((o) => o.title === t.title && o.body === t.body)) options.push({ ...t, checked: true });
    }
  }

  let changeOrders: AgreementEditorData["change_orders"] = [];
  if (a.kind === "work_order") {
    const { data } = await admin
      .from("sub_agreements")
      .select("id, number, status, price_basis, price, not_to_exceed")
      .eq("parent_id", a.id)
      .order("created_at", { ascending: true });
    changeOrders = (data ?? []).map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      amount: agreementAmount({ price_basis: r.price_basis, price: r.price == null ? null : Number(r.price), not_to_exceed: r.not_to_exceed == null ? null : Number(r.not_to_exceed), unit_rate: null, unit_label: null }),
    }));
  }

  // The sub's IP, device and login phone stay in the database and on the
  // executed PDF; the editor doesn't need them.
  const agreement: AgreementEditorData["agreement"] = { ...a };
  for (const key of ["sub_signed_ip", "sub_signed_ua", "sub_signed_access_id", "sub_signed_worker_id", "sub_signed_phone"]) {
    delete (agreement as Record<string, unknown>)[key];
  }

  return ok({
    agreement,
    sub: { id: b.sub.id, company_name: b.sub.company_name, contact_name: b.sub.contact_name, has_portal: !!b.portal, is_test: b.isTestSub },
    project: b.project ? { id: b.project.id, name: b.project.name, project_number: b.project.project_number } : null,
    template: {
      id: b.template.id,
      kind: b.template.kind,
      version: b.template.version,
      title: b.template.title,
      status: b.template.status,
      test_only: b.template.test_only,
      blanks: countFillIns(b.template.acceptance_text, b.template.esign_consent_text, ...b.template.sections.map((s) => s.body)),
    },
    master: b.master ? { id: b.master.id, number: b.master.number, status: b.master.status } : null,
    parent: b.parent ? { id: b.parent.id, number: b.parent.number } : null,
    flow_down_options: options,
    sources,
    blockers: a.status === "draft" ? blockers : [],
    change_orders: changeOrders,
    viewer: { can_sign: canSignSubAgreements(auth.user) },
    pdf_url: agreementPdfUrl(a.id),
  });
}

// ───────────────────────────────────────── Penney signs, then sends

type Signer = { id: string; name: string; title: string | null };

export interface SendResult {
  number: string;
  /** The master agreement that went out with a work order ("MSA-MGL-2026"). */
  alsoSent: string[];
  projectId: string | null;
}

async function createMasterDraft(admin: Admin, b: AgreementBundle, createdBy: string): Promise<Result<AgreementRow>> {
  const template = await pickTemplate(admin, "master", b.isTestSub, { approvedOnly: true });
  if (!template) return fail("The master agreement template isn't approved yet. It goes out with his first work order of the year.");
  const res = await insertAgreement(
    admin,
    { kind: "master", subcontractor_id: b.sub.id, project_id: null, template_id: template.id, status: "draft", created_by: createdBy },
    () => nextMasterNumber(admin, b.sub),
  );
  if (res.error !== null) return fail(res.error);
  const bundle = await loadAgreementBundle(admin, res.data.id);
  return bundle ? ok(bundle.agreement) : fail("Couldn't load the new master agreement");
}

/**
 * Penney signs first (plan §5.4), with the signer's OWN name and title, so
 * the sub's signature executes it. Before signing: a draft on an unapproved
 * template moves to the approved one, and a work order gets this year's
 * master agreement (made now if he has none). The sent copy is rendered,
 * stored, and its SHA-256 saved; that exact file is what he reads and signs.
 * Signing again after an edit re-renders; signing twice is a no-op.
 */
async function penneySignInternal(admin: Admin, id: string, signer: Signer): Promise<Result<{ number: string; projectId: string | null }>> {
  let b = await loadAgreementBundle(admin, id);
  if (!b) return fail("Agreement not found");
  if (b.agreement.status !== "draft") return fail(`${b.agreement.number} is already ${b.agreement.status}.`);
  if (b.agreement.penney_signed_at && b.agreement.pdf_sha256) return ok({ number: b.agreement.number, projectId: b.agreement.project_id });

  if (!templateUsableFor(b.template, b.isTestSub) || templateHasBlanks(b.template)) {
    const approved = await pickTemplate(admin, b.agreement.kind, b.isTestSub, { approvedOnly: true });
    if (!approved) return fail(`The ${AGREEMENT_KIND_LABEL[b.agreement.kind].toLowerCase()} template isn't approved yet. Approve it on Subcontractors, Agreements.`);
    const { error } = await admin.from("sub_agreements").update({ template_id: approved.id }).eq("id", id).eq("status", "draft");
    if (error) return fail(error.message);
    b = await loadAgreementBundle(admin, id);
    if (!b) return fail("Agreement not found");
  }

  const thisYear = todayET().slice(0, 4);
  if (b.agreement.kind === "work_order" && masterIsStale(b.master, thisYear)) {
    // A draft left open across New Year gets this year's master, not last year's.
    let master = await findCurrentMaster(admin, b.sub.id, thisYear);
    if (!master) {
      const made = await createMasterDraft(admin, b, signer.id);
      if (made.error !== null) return fail(made.error);
      master = made.data;
    }
    const { error } = await admin.from("sub_agreements").update({ master_id: master.id }).eq("id", id).eq("status", "draft");
    if (error) return fail(error.message);
    b = await loadAgreementBundle(admin, id);
    if (!b) return fail("Agreement not found");
  }

  const blockers = sendBlockers(b);
  if (blockers.length) return fail(blockers.join(" "));
  const overlap = await overlappingWorkOrders(admin, b.agreement);
  if (overlap.length) return fail(overlapMessage(overlap));

  const at = new Date().toISOString();
  const signed: AgreementBundle = {
    ...b,
    agreement: {
      ...b.agreement,
      // Rendered as it will read once sent: no draft watermark.
      status: "sent",
      penney_signer_id: signer.id,
      penney_signed_name: signer.name,
      penney_signed_title: signer.title,
      penney_signed_at: at,
    },
  };
  const pdf = renderAgreementPdf(signed, { includeSubSignature: false });
  const hash = sha256Hex(pdf);
  const storeError = await storeFile(admin, sentPdfPath(id), pdf, "application/pdf");
  if (storeError) return fail(`Couldn't save the PDF: ${storeError}`);

  const { data: saved, error } = await admin
    .from("sub_agreements")
    .update({
      penney_signer_id: signer.id,
      penney_signed_name: signer.name,
      penney_signed_title: signer.title,
      penney_signed_at: at,
      pdf_sha256: hash,
    })
    .eq("id", id)
    .eq("status", "draft")
    .is("penney_signed_at", null)
    // Only the row the PDF was rendered from: an edit saved meanwhile bumps
    // updated_at, and its words were never signed.
    .eq("updated_at", b.agreement.updated_at)
    .select("id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!saved) return fail("It changed while you were signing. Reload and try again.");
  return ok({ number: b.agreement.number, projectId: b.agreement.project_id });
}

/**
 * Send: the sub sees it in his portal's Needed list. A work order's master
 * agreement goes out with it (signed by Penney the same way) when it hasn't
 * gone out yet. No email or text is sent from here.
 */
async function sendInternal(admin: Admin, id: string, signer: Signer): Promise<Result<SendResult>> {
  const b = await loadAgreementBundle(admin, id);
  if (!b) return fail("Agreement not found");
  if (isAwaitingSubSignature(b.agreement.status)) return ok({ number: b.agreement.number, alsoSent: [], projectId: b.agreement.project_id });
  if (b.agreement.status !== "draft") return fail(`${b.agreement.number} is already ${b.agreement.status}.`);
  if (!b.agreement.penney_signed_at || !b.agreement.pdf_sha256) return fail("Penney's signature is missing. Sign it first.");
  const blockers = sendBlockers(b);
  if (blockers.length) return fail(blockers.join(" "));

  const alsoSent: string[] = [];
  if (b.agreement.kind === "work_order") {
    if (!b.master) return fail("This work order has no master agreement. Sign it again.");
    if (b.master.status === "draft") {
      const signedMaster = await penneySignInternal(admin, b.master.id, signer);
      if (signedMaster.error !== null) return fail(`Master agreement ${b.master.number}: ${signedMaster.error}`);
      const sentMaster = await sendInternal(admin, b.master.id, signer);
      if (sentMaster.error !== null) return fail(`Master agreement ${b.master.number}: ${sentMaster.error}`);
      alsoSent.push(b.master.number);
    } else if (b.master.status === "void" || b.master.status === "superseded") {
      return fail(`Master agreement ${b.master.number} was voided. Sign this work order again to attach a new one.`);
    }
  }

  const { data: saved, error } = await admin
    .from("sub_agreements")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .not("penney_signed_at", "is", null)
    .select("id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!saved) return fail("It changed while you were sending. Reload.");
  return ok({ number: b.agreement.number, alsoSent, projectId: b.agreement.project_id });
}

async function signerIdentity(admin: Admin, profile: NonNullable<AuthUser["realProfile"]>): Promise<Signer> {
  return loadSignerIdentity(admin, { id: profile.id, email: profile.email, full_name: profile.full_name });
}

/** Penney's signature only (it stays a draft until sent). */
export async function penneySignSubAgreement(id: string): Promise<Result<{ number: string; projectId: string | null }>> {
  const auth = await requireSigner("sign for Penney");
  if ("error" in auth) return fail(auth.error);
  const admin = createAdminClient();
  const res = await penneySignInternal(admin, id, await signerIdentity(admin, auth.profile));
  if (res.error === null) revalidateAgreement(res.data.projectId);
  return res;
}

/** Send a draft Penney already signed. */
export async function sendSubAgreement(id: string): Promise<Result<SendResult>> {
  const auth = await requireSigner("send a sub agreement");
  if ("error" in auth) return fail(auth.error);
  const admin = createAdminClient();
  const res = await sendInternal(admin, id, await signerIdentity(admin, auth.profile));
  if (res.error === null) revalidateAgreement(res.data.projectId);
  return res;
}

/** Ryan's one tap: sign for Penney, then send (with the master agreement when it's his first this year). */
export async function signAndSendSubAgreement(id: string): Promise<Result<SendResult>> {
  const auth = await requireSigner("sign and send a sub agreement");
  if ("error" in auth) return fail(auth.error);
  const admin = createAdminClient();
  const signer = await signerIdentity(admin, auth.profile);
  const signed = await penneySignInternal(admin, id, signer);
  if (signed.error !== null) return fail(signed.error);
  const sent = await sendInternal(admin, id, signer);
  revalidateAgreement(signed.data.projectId);
  return sent;
}

// ───────────────────────────────────────── void

/**
 * Void. A draft that never went out can be voided by the office; anything he
 * has seen or signed only by Ryan, with a reason (he reads it). Voiding a
 * signed work order also voids its signed change orders, then re-syncs the
 * job's contract amount (sync_sub_contract puts back the pre-lock amount
 * when nothing signed is left).
 */
export async function voidSubAgreement(id: string, reason: string): Promise<Result<{ number: string; contractAmount: number | null }>> {
  const user = await getUser();
  if (!user) return fail("Not signed in");
  const admin = createAdminClient();
  const row = await loadAgreementRow(admin, id);
  if (!row) return fail("Agreement not found");
  if (row.status === "void" || row.status === "superseded") return fail(`${row.number} is already ${row.status}.`);

  const wentOut = row.status !== "draft" || !!row.sent_at || !!row.penney_signed_at;
  if (wentOut) {
    if (!canSignSubAgreements(user)) return fail(`Only ${SUB_AGREEMENT_SIGNER_NAMES} can void an agreement that was signed or sent.`);
  } else if (!isAgreementOfficeRole(user.profile?.role)) {
    return fail("Only office staff can void a draft");
  }
  const why = reason.trim();
  if (wentOut && why.length < 3) return fail("Say why. The sub reads this.");

  // Another change order's sent copy already counts this signed one in its
  // revised total; voiding this first would make that copy wrong.
  if (row.kind === "change_order" && row.status === "signed" && row.parent_id) {
    const { data: open } = await admin
      .from("sub_agreements")
      .select("number, status, penney_signed_at")
      .eq("parent_id", row.parent_id)
      .eq("kind", "change_order")
      .neq("id", row.id)
      .in("status", ["draft", "sent", "viewed"]);
    const out = (open ?? []).filter((o) => o.status !== "draft" || !!o.penney_signed_at).map((o) => o.number as string);
    if (out.length) return fail(`Void ${out.join(", ")} first (its sent copy counts this one), then void this.`);
  }

  const actorId = user.realProfile?.id ?? user.id;
  const now = new Date().toISOString();
  const { data: saved, error } = await admin
    .from("sub_agreements")
    .update({ status: "void", void_reason: why || null, voided_by: actorId, voided_at: now })
    .eq("id", id)
    .eq("status", row.status)
    .select("id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!saved) return fail("It changed while you were voiding it. Reload.");

  if (row.kind === "work_order" && row.status === "signed") {
    await admin
      .from("sub_agreements")
      .update({ status: "void", void_reason: `Its work order ${row.number} was voided${why ? `: ${why}` : ""}`, voided_by: actorId, voided_at: now })
      .eq("parent_id", id)
      .in("status", ["draft", "sent", "viewed", "signed"]);
  }

  let contractAmount: number | null = null;
  if (row.status === "signed" && row.project_id && row.kind !== "master") {
    const { data: amount, error: syncError } = await admin.rpc("sync_sub_contract", { p_project: row.project_id, p_sub: row.subcontractor_id });
    if (syncError) return fail(`Voided, but the job's contract amount didn't update: ${syncError.message}`);
    contractAmount = amount == null ? null : Number(amount);
  }
  revalidateAgreement(row.project_id);
  return ok({ number: row.number, contractAmount });
}

// ───────────────────────────────────────── paper fallback

const PAPER_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
};

/** The sub-documents bucket's own limit (file_size_limit 20 MB). */
const PAPER_MAX_BYTES = 20 * 1024 * 1024;
const PAPER_EXTS = new Set(Object.values(PAPER_TYPES));

/**
 * Why this agreement can't be filed as signed on paper, or null. The paper is
 * the record, so the template and portal login don't gate this; it still
 * needs its scope and an amount to lock, and a change order can't land while
 * another one on the same work order is out (its sent copy would be wrong).
 */
function paperFilingProblem(b: AgreementBundle): string | null {
  const a = b.agreement;
  if (!["draft", "sent", "viewed"].includes(a.status)) return `${a.number} is already ${a.status}.`;
  const missing = sendBlockers(b).filter((m) => /scope|price|rate|not-to-exceed|unit|job|work order this changes/i.test(m));
  if (missing.length) return missing.join(" ");
  if (a.kind === "change_order" && a.status === "draft" && b.changeTotals?.openSiblings.length) {
    return openSiblingMessage(b.changeTotals.openSiblings);
  }
  return null;
}

/**
 * Step 1 of filing a paper-signed copy: a signed upload URL for the scan. The
 * phone or laptop uploads straight to storage (a server action can't take a
 * body over Vercel's 4.5 MB cap); the server picks the path.
 */
export async function preparePaperScanUpload(
  id: string,
  type: string,
  size: number,
): Promise<Result<{ path: string; token: string; ext: string }>> {
  const auth = await requireSigner("file a paper-signed agreement");
  if ("error" in auth) return fail(auth.error);
  const ext = PAPER_TYPES[type];
  if (!ext) return fail("The scan must be a PDF or a photo (JPEG, PNG, HEIC or WebP)");
  if (!Number.isFinite(size) || size <= 0) return fail("Add the scan of the signed copy");
  if (size > PAPER_MAX_BYTES) return fail("The scan is over 20 MB");
  const admin = createAdminClient();
  const b = await loadAgreementBundle(admin, id);
  if (!b) return fail("Agreement not found");
  const problem = paperFilingProblem(b);
  if (problem) return fail(problem);
  const path = paperScanPath(id, ext);
  const { data, error } = await admin.storage.from(SUB_DOCUMENTS_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) return fail(`Couldn't start the upload: ${error?.message ?? "no upload link"}`);
  return ok({ path, token: data.token, ext });
}

/**
 * Step 2: a copy signed on paper (plan §5.4). The scan is already in storage
 * (preparePaperScanUpload); this files it and locks the same way a portal
 * signature does. signerName is who signed for the sub; signedOn is
 * YYYY-MM-DD (default today); ext is the scan's type from step 1.
 */
export async function markSubAgreementSignedOnPaper(input: {
  id: string;
  signerName: string;
  signedOn?: string | null;
  ext: string;
}): Promise<Result<{ number: string; contractAmount: number | null }>> {
  const auth = await requireSigner("file a paper-signed agreement");
  if ("error" in auth) return fail(auth.error);
  const id = String(input.id ?? "");
  const signerName = String(input.signerName ?? "").trim();
  const signedOn = String(input.signedOn ?? "").trim() || todayET();
  const ext = String(input.ext ?? "");
  if (!id) return fail("Agreement missing");
  if (signerName.length < 2) return fail("Who signed it for the sub?");
  if (!isCalendarDay(signedOn) || signedOn > todayET()) return fail("Pick the day it was signed (not in the future)");
  if (!PAPER_EXTS.has(ext)) return fail("The scan must be a PDF or a photo (JPEG, PNG, HEIC or WebP)");

  const admin = createAdminClient();
  const b = await loadAgreementBundle(admin, id);
  if (!b) return fail("Agreement not found");
  const a = b.agreement;
  const problem = paperFilingProblem(b);
  if (problem) return fail(problem);

  // The server rebuilds the path (never trusts one from the browser) and the
  // scan has to really be there.
  const path = paperScanPath(id, ext);
  const bucket = admin.storage.from(SUB_DOCUMENTS_BUCKET);
  const { data: info, error: infoError } = await bucket.info(path);
  if (infoError || !info) {
    const { data: there } = await bucket.exists(path);
    if (!there) return fail("The scan didn't upload. Try again.");
  } else if (typeof info.size === "number" && info.size > PAPER_MAX_BYTES) {
    return fail("The scan is over 20 MB");
  }

  const signer = await signerIdentity(admin, auth.profile);
  const signedAt = new Date(`${signedOn}T16:00:00Z`).toISOString(); // midday ET
  const update: Record<string, unknown> = {
    status: "signed",
    signed_on_paper: true,
    sub_signed_name: signerName,
    sub_signed_at: signedAt,
    signed_pdf_path: path,
  };
  if (!a.penney_signed_at) {
    Object.assign(update, { penney_signer_id: signer.id, penney_signed_name: signer.name, penney_signed_title: signer.title, penney_signed_at: signedAt });
  }
  const { data: saved, error } = await admin
    .from("sub_agreements")
    .update(update)
    .eq("id", id)
    .eq("status", a.status)
    .is("sub_signed_at", null)
    .select("id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!saved) return fail("It was signed or changed in the meantime. Reload.");

  let contractAmount: number | null = null;
  if (a.project_id && a.kind !== "master") {
    const { data: amount, error: syncError } = await admin.rpc("sync_sub_contract", { p_project: a.project_id, p_sub: a.subcontractor_id });
    if (syncError) return fail(`Filed as signed, but the job's contract amount didn't lock: ${syncError.message}`);
    contractAmount = amount == null ? null : Number(amount);
  }
  after(() =>
    notifySubAgreementSigned({
      agreementId: id,
      subId: a.subcontractor_id,
      projectId: a.project_id,
      number: a.number,
      kind: a.kind,
      signedName: signerName,
      onPaper: true,
    }),
  );
  revalidateAgreement(a.project_id);
  return ok({ number: a.number, contractAmount });
}

// ───────────────────────────────────────── templates (Ryan's page)

export interface TemplateDraftInput {
  title?: string;
  sections?: SubAgreementSection[];
  acceptance_text?: string;
  esign_consent_text?: string;
}

/** Save the words of a draft template (filling blanks, marking sections read). */
export async function saveTemplateDraft(id: string, input: TemplateDraftInput): Promise<Result<{ blanks: number }>> {
  const auth = await requireTemplateEditor();
  if ("error" in auth) return fail(auth.error);
  const admin = createAdminClient();
  const t = await loadTemplate(admin, id);
  if (!t) return fail("Template not found");
  if (t.status !== "draft") return fail("Approved text can't change. Make a new version.");

  const update: Record<string, unknown> = {};
  const clean = (s: string) => s.replace(/\r\n?/g, "\n");
  if (input.title != null) {
    if (!input.title.trim()) return fail("The title can't be empty");
    update.title = input.title.trim();
  }
  if (input.sections) update.sections = toSections(input.sections).map((s) => ({ title: clean(s.title).trim(), body: clean(s.body).trim() }));
  if (input.acceptance_text != null) update.acceptance_text = clean(input.acceptance_text).trim();
  if (input.esign_consent_text != null) update.esign_consent_text = clean(input.esign_consent_text).trim();
  if (Object.keys(update).length === 0) return ok({ blanks: countTemplateBlanks(t) });

  const { data: saved, error } = await admin
    .from("sub_agreement_templates")
    .update(update)
    .eq("id", id)
    .eq("status", "draft")
    .select(
      "id, kind, version, title, source_pdf_path, sections, acceptance_text, esign_consent_text, provenance, status, test_only, approved_by, approved_at, created_at, updated_at",
    )
    .maybeSingle();
  if (error) return fail(error.message);
  if (!saved) return fail("It was approved in the meantime. Reload.");
  revalidatePath("/subcontractors/agreements");
  return ok({ blanks: countTemplateBlanks({ ...t, ...(saved as Partial<TemplateRow>), sections: toSections(saved.sections) }) });
}

function countTemplateBlanks(t: Pick<TemplateRow, "sections" | "acceptance_text" | "esign_consent_text">): number {
  return countFillIns(t.acceptance_text, t.esign_consent_text, ...t.sections.flatMap((s) => [s.title, s.body]));
}

function etLongDate(d = new Date()): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

/**
 * Ryan approves a template. One UPDATE sets status, provenance ("Reviewed and
 * approved by Ryan Penney on October 17, 2026"), approved_by and approved_at;
 * the database refuses it while any "[FILL IN" is left (approved_needs_review)
 * and freezes the text afterwards. The older approved version of the same
 * kind retires, so new agreements pick this one; signed ones keep pointing at
 * the words they were signed on.
 */
export async function approveTemplate(id: string): Promise<Result<{ provenance: string; retired: number; outstanding: number }>> {
  const auth = await requireSigner("approve agreement text");
  if ("error" in auth) return fail(auth.error);
  const admin = createAdminClient();
  const t = await loadTemplate(admin, id);
  if (!t) return fail("Template not found");
  if (t.status !== "draft") return fail(`It is already ${t.status}.`);
  const blanks = countTemplateBlanks(t);
  if (blanks > 0) return fail(`${blanks} [FILL IN] blank${blanks === 1 ? " is" : "s are"} left. Fill ${blanks === 1 ? "it" : "them"} first.`);
  if (t.kind !== "change_order" && t.sections.length === 0) return fail("It has no sections yet.");
  if (!t.acceptance_text.trim() || !t.esign_consent_text.trim()) return fail("The acceptance statement and the e-sign consent can't be empty.");
  if (hasFillInBlank(t.title)) return fail("The title still has a blank.");

  const signer = await signerIdentity(admin, auth.profile);
  const now = new Date();
  const provenance = `Reviewed and approved by ${signer.name} on ${etLongDate(now)}`;
  const { data: saved, error } = await admin
    .from("sub_agreement_templates")
    .update({ status: "approved", provenance, approved_by: signer.id, approved_at: now.toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error) {
    if (/approved_needs_review/.test(error.message)) return fail("The database refused: a blank or a section is missing. Reload and check.");
    return fail(error.message);
  }
  if (!saved) return fail("It changed in the meantime. Reload.");

  const { data: retired } = await admin
    .from("sub_agreement_templates")
    .update({ status: "retired" })
    .eq("kind", t.kind)
    .eq("status", "approved")
    .eq("test_only", t.test_only)
    .lt("version", t.version)
    .select("id");
  // Agreements already sent on the older words stay on them until signed
  // (templateHoldsFor); the office sees how many.
  const retiredIds = (retired ?? []).map((r) => r.id as string);
  const { count: outstanding } = retiredIds.length
    ? await admin.from("sub_agreements").select("id", { count: "exact", head: true }).in("template_id", retiredIds).in("status", ["sent", "viewed"])
    : { count: 0 };
  revalidatePath("/subcontractors/agreements");
  return ok({ provenance, retired: retiredIds.length, outstanding: outstanding ?? 0 });
}

/**
 * A new draft version to change approved text (approved text is frozen).
 * Copies the newest version of that kind; `testOnly` makes a TEST-only one
 * for the §8 walk-through (usable only with a TEST sub).
 */
export async function newTemplateVersion(kind: SubAgreementKind, opts: { testOnly?: boolean } = {}): Promise<Result<{ id: string; version: number }>> {
  const auth = await requireTemplateEditor();
  if ("error" in auth) return fail(auth.error);
  const admin = createAdminClient();
  const { data } = await admin
    .from("sub_agreement_templates")
    .select("id, version, title, sections, acceptance_text, esign_consent_text, status, test_only")
    .eq("kind", kind)
    .order("version", { ascending: false });
  const rows = data ?? [];
  if (rows.some((r) => r.status === "draft" && !!r.test_only === !!opts.testOnly)) {
    return fail(`There is already a draft ${opts.testOnly ? "TEST " : ""}version to work on.`);
  }
  const source = rows.find((r) => !r.test_only && r.status !== "retired") ?? rows[0];
  const version = (rows[0]?.version ?? 0) + 1;
  const { data: made, error } = await admin
    .from("sub_agreement_templates")
    .insert({
      kind,
      version,
      title: opts.testOnly ? `TEST ${source?.title ?? AGREEMENT_KIND_LABEL[kind]}` : (source?.title ?? AGREEMENT_KIND_LABEL[kind]),
      sections: source?.sections ?? [],
      acceptance_text: source?.acceptance_text ?? "[FILL IN: acceptance statement]",
      esign_consent_text: source?.esign_consent_text ?? "[FILL IN: e-sign consent]",
      status: "draft",
      test_only: !!opts.testOnly,
    })
    .select("id, version")
    .single();
  if (error) return fail(error.message);
  revalidatePath("/subcontractors/agreements");
  return ok(made as { id: string; version: number });
}

/** Retire an approved template (no new agreements use it; signed ones keep it). */
export async function retireTemplate(id: string): Promise<Result<{ id: string }>> {
  const auth = await requireSigner("retire agreement text");
  if ("error" in auth) return fail(auth.error);
  const admin = createAdminClient();
  const { data, error } = await admin.from("sub_agreement_templates").update({ status: "retired" }).eq("id", id).eq("status", "approved").select("id").maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Only an approved template can be retired");
  revalidatePath("/subcontractors/agreements");
  return ok({ id });
}
