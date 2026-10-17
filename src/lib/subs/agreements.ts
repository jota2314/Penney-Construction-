import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { roundCents } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { etDate, todayET } from "@/lib/sub-portal/et-day";
import { hasFillInBlank, isAwaitingSubSignature, type SubAgreementStatus, type SubTemplateStatus } from "@/lib/sub-portal/statuses";
import type {
  SubAgreementDetail,
  SubAgreementDraw,
  SubAgreementKind,
  SubAgreementSection,
  SubAgreementSummary,
  SubNeededSignAgreement,
  SubPortalMode,
  SubPriceBasis,
} from "@/lib/sub-portal/payload";
import {
  AGREEMENT_KIND_LABEL,
  agreementAmount,
  agreementTitle,
  companyCode,
  flowDownByDefault,
  isTestSubName,
  jobCode,
} from "@/lib/subs/agreement-format";

/**
 * Sub agreements (plan §5, ADDENDUM 2): the master subcontract agreement
 * each sub signs once a year, the per-job work order, and the sub change
 * order. This module loads them, drafts a work order from what the office
 * already agreed (auto-fill), numbers them, decides whether one may be sent
 * or signed, and builds the payloads the sub portal reads.
 *
 * Ground rules:
 *  - Legal text comes ONLY from a template Ryan approved. Nothing here writes
 *    or rewrites terms; auto-fill copies the sub's own words (quote scope
 *    verbatim, exclusions quoted from his quote) and the office edits.
 *  - Client prices, markup and other subs never appear on an agreement.
 *  - Money is to the cent (roundCents); null means not set, never 0.
 *  - Writes go through the service role (office-read RLS only on these tables).
 */

type DB = SupabaseClient;

/** Private bucket for agreement PDFs (W0 migration): service role only. */
export const SUB_DOCUMENTS_BUCKET = "sub-documents";
/** The exact PDF Penney signed and sent; its SHA-256 is `pdf_sha256`. */
export const sentPdfPath = (id: string) => `agreements/${id}/sent.pdf`;
/** The executed copy with both signatures and the e-sign record. */
export const signedPdfPath = (id: string) => `agreements/${id}/signed.pdf`;
/** A paper-signed scan the office filed. */
export const paperScanPath = (id: string, ext: string) => `agreements/${id}/signed-paper.${ext}`;

export const AGREEMENT_WATERMARK_DRAFT = "DRAFT - NOT FOR SIGNATURE";

/** The roles that may draft and edit agreements (signing is Ryan only, role-access.ts). */
export const AGREEMENT_OFFICE_ROLES = ["owner", "precon_manager", "project_manager", "office_admin"] as const;

export function isAgreementOfficeRole(role: string | null | undefined): boolean {
  return !!role && (AGREEMENT_OFFICE_ROLES as readonly string[]).includes(role);
}

/**
 * The signed-in office user on this request (route handlers), or null for
 * nobody, a field login, or a sub. Reading only: signing has its own gate.
 */
export async function getOfficeViewerId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).maybeSingle();
  return isAgreementOfficeRole(profile?.role as string | undefined) ? user.id : null;
}

// ───────────────────────────────────────── rows

export interface TemplateRow {
  id: string;
  kind: SubAgreementKind;
  version: number;
  title: string;
  source_pdf_path: string | null;
  sections: SubAgreementSection[];
  acceptance_text: string;
  esign_consent_text: string;
  provenance: string | null;
  status: SubTemplateStatus;
  test_only: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export const TEMPLATE_COLUMNS =
  "id, kind, version, title, source_pdf_path, sections, acceptance_text, esign_consent_text, provenance, status, test_only, approved_by, approved_at, created_at, updated_at";

export interface AgreementRow {
  id: string;
  number: string;
  kind: SubAgreementKind;
  subcontractor_id: string;
  project_id: string | null;
  master_id: string | null;
  parent_id: string | null;
  template_id: string;
  scope_text: string | null;
  exclusions_text: string | null;
  price_basis: SubPriceBasis | null;
  price: number | null;
  unit_rate: number | null;
  unit_label: string | null;
  not_to_exceed: number | null;
  draws: SubAgreementDraw[];
  start_date: string | null;
  end_date: string | null;
  schedule_phase_ids: string[];
  quote_request_ids: string[];
  estimate_line_item_ids: string[];
  additional_terms: SubAgreementSection[];
  status: SubAgreementStatus;
  penney_signer_id: string | null;
  penney_signed_name: string | null;
  penney_signed_title: string | null;
  penney_signed_at: string | null;
  sent_at: string | null;
  first_viewed_at: string | null;
  view_count: number;
  sub_signed_name: string | null;
  sub_signed_at: string | null;
  sub_signed_ip: string | null;
  sub_signed_ua: string | null;
  sub_signed_access_id: string | null;
  sub_signed_worker_id: string | null;
  sub_signed_phone: string | null;
  esign_consent_at: string | null;
  signed_on_paper: boolean;
  pdf_sha256: string | null;
  signed_pdf_path: string | null;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgreementSubRow {
  id: string;
  company_name: string;
  contact_name: string | null;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  license_number: string | null;
}

const SUB_COLUMNS = "id, company_name, contact_name, legal_name, email, phone, address, city, state, zip, license_number";

export interface AgreementProjectRow {
  id: string;
  name: string;
  project_number: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  contract_additional_terms: unknown;
}

const PROJECT_COLUMNS = "id, name, project_number, address, city, state, zip, contract_additional_terms";

/** Everything one agreement needs to be shown, gated, rendered or signed. */
export interface AgreementBundle {
  agreement: AgreementRow;
  template: TemplateRow;
  sub: AgreementSubRow;
  project: AgreementProjectRow | null;
  /** The master agreement a work order sits under. */
  master: AgreementRow | null;
  /** The work order a sub change order changes. */
  parent: AgreementRow | null;
  /**
   * For a sub change order: the work order price, the other signed changes on
   * it, and the numbers of other change orders on it still out for the sub's
   * signature (sent, opened, or Penney-signed drafts whose sent copy exists).
   */
  changeTotals: { workOrder: number | null; otherSignedChanges: number; openSiblings: string[] } | null;
  /** He has an enabled sub portal login (the Send gate). */
  portal: { access_id: string; phone_login: string | null } | null;
  isTestSub: boolean;
}

// ───────────────────────────────────────── normalizers

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? roundCents(n) : null;
};

export function toSections(v: unknown): SubAgreementSection[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => ({
      title: typeof s?.title === "string" ? s.title : "",
      body: typeof s?.body === "string" ? s.body : "",
    }))
    .filter((s) => s.title.trim() || s.body.trim());
}

export function toDraws(v: unknown): SubAgreementDraw[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((d) => ({
      label: typeof d?.label === "string" ? d.label : "",
      amount: num(d?.amount),
      percent: d?.percent == null || d.percent === "" || !Number.isFinite(Number(d.percent)) ? null : Number(d.percent),
      when: typeof d?.when === "string" && d.when.trim() ? d.when : null,
    }))
    .filter((d) => d.label.trim() || d.amount != null);
}

function normalizeAgreement(r: Record<string, unknown>): AgreementRow {
  return {
    ...(r as unknown as AgreementRow),
    price: num(r.price),
    unit_rate: num(r.unit_rate),
    not_to_exceed: num(r.not_to_exceed),
    draws: toDraws(r.draws),
    additional_terms: toSections(r.additional_terms),
    schedule_phase_ids: Array.isArray(r.schedule_phase_ids) ? (r.schedule_phase_ids as string[]) : [],
    quote_request_ids: Array.isArray(r.quote_request_ids) ? (r.quote_request_ids as string[]) : [],
    estimate_line_item_ids: Array.isArray(r.estimate_line_item_ids) ? (r.estimate_line_item_ids as string[]) : [],
    view_count: Number(r.view_count ?? 0),
    signed_on_paper: !!r.signed_on_paper,
  };
}

function normalizeTemplate(r: Record<string, unknown>): TemplateRow {
  return { ...(r as unknown as TemplateRow), sections: toSections(r.sections), test_only: !!r.test_only };
}

// ───────────────────────────────────────── loading

export async function loadTemplate(admin: DB, id: string): Promise<TemplateRow | null> {
  const { data } = await admin.from("sub_agreement_templates").select(TEMPLATE_COLUMNS).eq("id", id).maybeSingle();
  return data ? normalizeTemplate(data) : null;
}

export async function loadAgreementRow(admin: DB, id: string): Promise<AgreementRow | null> {
  const { data } = await admin.from("sub_agreements").select("*").eq("id", id).maybeSingle();
  return data ? normalizeAgreement(data) : null;
}

export async function loadAgreementBundle(admin: DB, id: string): Promise<AgreementBundle | null> {
  const agreement = await loadAgreementRow(admin, id);
  if (!agreement) return null;

  const [template, subRes, projectRes, master, parent, accessRes] = await Promise.all([
    loadTemplate(admin, agreement.template_id),
    admin.from("subcontractors").select(SUB_COLUMNS).eq("id", agreement.subcontractor_id).maybeSingle(),
    agreement.project_id
      ? admin.from("projects").select(PROJECT_COLUMNS).eq("id", agreement.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    agreement.master_id ? loadAgreementRow(admin, agreement.master_id) : Promise.resolve(null),
    agreement.parent_id ? loadAgreementRow(admin, agreement.parent_id) : Promise.resolve(null),
    admin
      .from("sub_portal_access")
      .select("id, phone_login, enabled")
      .eq("subcontractor_id", agreement.subcontractor_id)
      .eq("enabled", true)
      .order("created_at", { ascending: true })
      .limit(1),
  ]);
  if (!template || !subRes.data) return null;
  const sub = subRes.data as AgreementSubRow;

  let changeTotals: AgreementBundle["changeTotals"] = null;
  if (agreement.kind === "change_order" && parent) {
    const { data: siblings } = await admin
      .from("sub_agreements")
      .select("id, number, status, penney_signed_at, price_basis, price, not_to_exceed")
      .eq("parent_id", parent.id)
      .eq("kind", "change_order")
      .in("status", ["draft", "sent", "viewed", "signed"])
      .neq("id", agreement.id);
    const others = (siblings ?? []).filter((o) => o.status === "signed");
    const openSiblings = (siblings ?? [])
      .filter((o) => o.status === "sent" || o.status === "viewed" || (o.status === "draft" && !!o.penney_signed_at))
      .map((o) => o.number as string);
    const otherSignedChanges = roundCents(
      others.reduce((s, o) => s + (agreementAmount({
        price_basis: o.price_basis,
        price: num(o.price),
        not_to_exceed: num(o.not_to_exceed),
        unit_rate: null,
        unit_label: null,
      }) ?? 0), 0),
    );
    changeTotals = { workOrder: agreementAmount(parent), otherSignedChanges, openSiblings };
  }

  const access = (accessRes.data ?? [])[0] as { id: string; phone_login: string | null } | undefined;
  return {
    agreement,
    template,
    sub,
    project: (projectRes.data as AgreementProjectRow | null) ?? null,
    master,
    parent,
    changeTotals,
    portal: access ? { access_id: access.id, phone_login: access.phone_login ?? null } : null,
    isTestSub: isTestSubName(sub.company_name),
  };
}

// ───────────────────────────────────────── templates

/** Approved and usable for this sub: a test-only template only ever with a TEST sub. */
export function templateUsableFor(template: Pick<TemplateRow, "status" | "test_only">, isTestSub: boolean): boolean {
  return template.status === "approved" && (!template.test_only || isTestSub);
}

/**
 * The template an agreement may keep once Penney has signed it and stored the
 * sent copy: approved, or approved and since retired (a newer version was
 * approved after it went out). He signs the exact stored copy, so retiring the
 * words later doesn't strand it. Drafts still need an approved template, and a
 * signed agreement keeps the words it was signed on.
 */
export function templateHoldsFor(b: Pick<AgreementBundle, "agreement" | "template" | "isTestSub">): boolean {
  const t = b.template;
  if (t.test_only && !b.isTestSub) return false;
  if (t.status === "approved") return true;
  if (t.status !== "retired") return false;
  const a = b.agreement;
  if (a.status === "signed") return true;
  return a.status !== "draft" && !!a.penney_signed_at && !!a.pdf_sha256;
}

/** Any "[FILL IN" left in the template's text. */
export function templateHasBlanks(t: Pick<TemplateRow, "sections" | "acceptance_text" | "esign_consent_text">): boolean {
  return hasFillInBlank(t.acceptance_text, t.esign_consent_text, ...t.sections.flatMap((s) => [s.title, s.body]));
}

/**
 * The template a new or about-to-be-signed agreement should use: the newest
 * approved one this sub may use (a TEST sub prefers a test-only one), or, for
 * drafting before Ryan has approved anything, the newest draft. Retired
 * templates are never picked.
 */
export async function pickTemplate(
  admin: DB,
  kind: SubAgreementKind,
  isTestSub: boolean,
  opts: { approvedOnly?: boolean } = {},
): Promise<TemplateRow | null> {
  const { data } = await admin
    .from("sub_agreement_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("kind", kind)
    .order("version", { ascending: false });
  const rows = (data ?? []).map(normalizeTemplate);
  const approved = rows.filter((t) => templateUsableFor(t, isTestSub));
  const best = isTestSub ? (approved.find((t) => t.test_only) ?? approved[0]) : approved[0];
  if (best || opts.approvedOnly) return best ?? null;
  return rows.find((t) => t.status === "draft" && !t.test_only) ?? rows.find((t) => t.status === "draft") ?? null;
}

// ───────────────────────────────────────── gates

/** Penney's signature and an approved template are in place, and nothing blocks the sub's signature. */
export function subSignBlockers(b: AgreementBundle): string[] {
  const out: string[] = [];
  const a = b.agreement;
  if (!isAwaitingSubSignature(a.status)) out.push(a.status === "signed" ? "This is already signed." : "This isn't waiting for a signature.");
  if (!a.penney_signed_at) out.push("Penney hasn't signed this yet.");
  if (!templateHoldsFor(b) || templateHasBlanks(b.template)) out.push("This document isn't ready to sign yet. Penney will send it again.");
  if (!a.pdf_sha256) out.push("This document isn't ready to sign yet. Penney will send it again.");
  if (a.kind === "work_order" && b.master && !isSignedAgreement(b.master)) {
    out.push(`Sign your master agreement ${b.master.number} first.`);
  }
  if (a.kind === "change_order" && (!b.parent || !isSignedAgreement(b.parent))) {
    out.push("The work order this changes isn't signed yet.");
  }
  return Array.from(new Set(out));
}

export function isSignedAgreement(a: Pick<AgreementRow, "status">): boolean {
  return a.status === "signed";
}

/**
 * Why this agreement can't go out yet, in the office's words. Empty = ready
 * (Penney's own signature is checked separately; it happens in the same tap).
 * Plan §5.5: an approved template (a test-only one only with a TEST sub), no
 * "[FILL IN" anywhere, an amount (or rate + not-to-exceed), a scope, and a
 * sub with a portal login.
 */
export function sendBlockers(b: AgreementBundle): string[] {
  const out: string[] = [];
  const a = b.agreement;
  const kindWord = AGREEMENT_KIND_LABEL[a.kind].toLowerCase();
  if (a.status !== "draft") out.push(`It's already ${a.status}.`);
  if (b.template.status !== "approved") {
    out.push(`The ${kindWord} template isn't approved yet. Ryan approves it on Subcontractors, Agreements.`);
  } else if (b.template.test_only && !b.isTestSub) {
    out.push("This uses a TEST-only template, which can't go to a real sub.");
  }
  if (templateHasBlanks(b.template)) out.push(`The ${kindWord} template still has [FILL IN] blanks.`);
  if (hasFillInBlank(a.scope_text, a.exclusions_text, ...a.additional_terms.flatMap((t) => [t.title, t.body]))) {
    out.push("This agreement still has a [FILL IN] blank in it.");
  }
  if (a.kind !== "master") {
    if (!a.scope_text?.trim()) out.push("Write the scope.");
    if (!a.price_basis) out.push("Pick how the price works (lump sum, unit price or time and material).");
    else if (a.price_basis === "time_and_material") {
      if (a.unit_rate == null || a.unit_rate <= 0) out.push("Enter the time-and-material rate.");
      if (a.not_to_exceed == null || a.not_to_exceed <= 0) out.push("Enter the not-to-exceed amount.");
    } else {
      if (a.price == null || (a.kind === "work_order" && a.price <= 0)) out.push("Enter the price.");
      if (a.price_basis === "unit" && (a.unit_rate == null || !a.unit_label?.trim())) out.push("Enter the unit price and the unit.");
    }
    if (!a.project_id) out.push("Pick the job.");
  }
  if (a.kind === "work_order") {
    // The payment schedule he signs has to add up to the price he signs.
    const committed = agreementAmount(a);
    const withAmount = a.draws.filter((d) => d.amount != null);
    if (withAmount.length && committed != null) {
      const total = roundCents(withAmount.reduce((s, d) => s + (d.amount ?? 0), 0));
      const tm = a.price_basis === "time_and_material";
      if (tm ? total > roundCents(committed) : total !== roundCents(committed)) {
        out.push(`The payments add up to $${total.toFixed(2)} but the ${tm ? "not-to-exceed" : "price"} is $${roundCents(committed).toFixed(2)}. Fix the payments.`);
      }
    } else if (!withAmount.length && a.draws.some((d) => d.percent != null)) {
      const pct = a.draws.reduce((s, d) => s + (d.percent ?? 0), 0);
      if (Math.abs(pct - 100) > 0.001) out.push(`The payments add up to ${pct}%, not 100%. Fix the payments.`);
    }
  }
  if (a.kind === "change_order" && (!b.parent || !isSignedAgreement(b.parent))) {
    out.push("The work order this changes has to be signed first.");
  }
  if (a.kind === "change_order" && b.changeTotals?.openSiblings.length) {
    const open = b.changeTotals.openSiblings;
    out.push(`${open.join(", ")} on this work order ${open.length === 1 ? "is" : "are"} still out for signature. Get ${open.length === 1 ? "it" : "them"} signed or void ${open.length === 1 ? "it" : "them"} first, so this one shows the right revised total.`);
  }
  if (!b.portal) out.push(`${b.sub.company_name} has no sub portal login yet. Set one up from Subcontractors first.`);
  return Array.from(new Set(out));
}

// ───────────────────────────────────────── numbers

function etYear(): string {
  return todayET().slice(0, 4);
}

async function numberTaken(admin: DB, number: string): Promise<boolean> {
  const { data } = await admin.from("sub_agreements").select("id").eq("number", number).maybeSingle();
  return !!data;
}

/**
 * WO-046-01, WO-046-02… per job ("046" from PC-2026-046). If another year's
 * job 046 already used that run, the year goes in: WO-2027-046-01.
 */
export async function nextWorkOrderNumber(admin: DB, project: { id: string; project_number: string | null }): Promise<string> {
  const code = jobCode(project.project_number);
  const { data } = await admin
    .from("sub_agreements")
    .select("number, project_id")
    .eq("kind", "work_order")
    .like("number", `WO-%${code}-%`);
  const rows = (data ?? []) as { number: string; project_id: string | null }[];
  const plain = new RegExp(`^WO-${code}-(\\d+)$`);
  const foreign = rows.some((r) => plain.test(r.number) && r.project_id !== project.id);
  const year = (project.project_number ?? "").match(/(\d{4})/)?.[1] ?? etYear();
  const prefix = foreign ? `WO-${year}-${code}` : `WO-${code}`;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let seq = rows.reduce((max, r) => Math.max(max, Number(r.number.match(re)?.[1] ?? 0)), 0) + 1;
  let candidate = `${prefix}-${String(seq).padStart(2, "0")}`;
  while (await numberTaken(admin, candidate)) {
    seq += 1;
    candidate = `${prefix}-${String(seq).padStart(2, "0")}`;
  }
  return candidate;
}

/** SCO-046-01-1, -2… under work order WO-046-01. */
export async function nextChangeOrderNumber(admin: DB, parent: { id: string; number: string }): Promise<string> {
  const base = `SCO-${parent.number.replace(/^WO-/, "")}`;
  const { data } = await admin.from("sub_agreements").select("number").like("number", `${base}-%`);
  const re = new RegExp(`^${base.replace(/[-]/g, "\\-")}-(\\d+)$`);
  let seq = ((data ?? []) as { number: string }[]).reduce((m, r) => Math.max(m, Number(r.number.match(re)?.[1] ?? 0)), 0) + 1;
  while (await numberTaken(admin, `${base}-${seq}`)) seq += 1;
  return `${base}-${seq}`;
}

/** MSA-MGL-2026; a second company with the same code gets MSA-MGL-2026-2. */
export async function nextMasterNumber(admin: DB, sub: { company_name: string }, year = etYear()): Promise<string> {
  const base = `MSA-${companyCode(sub.company_name)}-${year}`;
  if (!(await numberTaken(admin, base))) return base;
  let n = 2;
  while (await numberTaken(admin, `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * This year's master agreement for a sub that is still live (draft, sent,
 * opened or signed), newest first. Null when he has none this year.
 */
export async function findCurrentMaster(admin: DB, subId: string, year = etYear()): Promise<AgreementRow | null> {
  const { data } = await admin
    .from("sub_agreements")
    .select("*")
    .eq("subcontractor_id", subId)
    .eq("kind", "master")
    .in("status", ["draft", "sent", "viewed", "signed"])
    .order("created_at", { ascending: false });
  const rows = (data ?? []).map(normalizeAgreement);
  const thisYear = rows.filter((r) => (etDate(r.created_at) ?? "").startsWith(year));
  return thisYear.find((r) => r.status === "signed") ?? thisYear[0] ?? null;
}

// ───────────────────────────────────────── auto-fill

export interface WorkOrderAutofill {
  scope_text: string | null;
  exclusions_text: string | null;
  price_basis: SubPriceBasis | null;
  price: number | null;
  draws: SubAgreementDraw[];
  start_date: string | null;
  end_date: string | null;
  schedule_phase_ids: string[];
  quote_request_ids: string[];
  estimate_line_item_ids: string[];
  /** The owner/association terms ticked by default. */
  additional_terms: SubAgreementSection[];
  /** Every owner/association term on the job, with its default tick. */
  flow_down_options: (SubAgreementSection & { checked: boolean })[];
  /** Where each field came from, for the office ("Scope: his quote of Oct 2, word for word"). */
  sources: string[];
}

const QUOTE_EXCLUSION_HEADING = /^\s*(?:exclusions?(?:\s*(?:&|and)\s*clarifications)?|excludes|excluded|not included|items not included|this (?:quote|price|proposal) does not include)\b\s*[:\-]?\s*/i;
const NEXT_HEADING = /^\s*(?:terms|payment|total|price|notes?|warranty|acceptance|inclusions?|includes|scope|thank you|signature|sincerely)\b.*:?\s*$/i;

/**
 * The exclusions block of the sub's own quote, word for word, or null. Only
 * ever quotes his document (plan §5.3); never writes one.
 */
export function quoteExclusions(text: string | null | undefined): string | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => QUOTE_EXCLUSION_HEADING.test(l));
  if (start === -1) return null;
  const out: string[] = [];
  const rest = lines[start].replace(QUOTE_EXCLUSION_HEADING, "").trim();
  if (rest) out.push(rest);
  for (let i = start + 1; i < lines.length && out.length < 25; i++) {
    const l = lines[i].trim();
    if (!l) {
      if (out.length) break;
      continue;
    }
    if (NEXT_HEADING.test(l) && out.length) break;
    out.push(l);
  }
  const joined = out.join("\n").trim();
  return joined ? joined.slice(0, 2000) : null;
}

/** "2026-10-02T…" → "Oct 2". */
function shortDay(iso: string | null | undefined): string {
  const d = etDate(iso ?? "");
  if (!d) return "";
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * What a new work order for this sub on this job should say, from what is
 * already agreed:
 *  - scope: his accepted quotes' scope, word for word (several are joined);
 *    else the scope of the bid package he priced for his awarded estimate
 *    lines (never the lines' own text, which is client proposal wording);
 *    else the job link's scope note
 *  - price: the SUM of his accepted quotes (awardQuote keeps only the latest
 *    on project_subcontractors, the Cosentino lesson); else the awarded line
 *    costs; else the job link's amount while it isn't locked and he has no
 *    other work order on the job
 *  - quotes and awarded lines already on another live work order of his on
 *    this job are left out (they'd be counted twice once both are signed);
 *    `excludeAgreementId` is the work order being edited, which never counts
 *    against itself
 *  - exclusions: quoted from his own quote text, when it has a block
 *  - dates: the first start and last end of his phases on the job
 *  - owner/association terms: the job's contract_additional_terms
 *  - one "On completion" draw for the whole price, which the office edits
 */
export async function loadWorkOrderAutofill(
  admin: DB,
  projectId: string,
  subId: string,
  opts: { excludeAgreementId?: string } = {},
): Promise<WorkOrderAutofill> {
  const sources: string[] = [];
  const [quotesRes, phasesRes, linkRes, projectRes, estimateRes, otherWosRes] = await Promise.all([
    admin
      .from("quote_requests")
      .select("id, trade, amount, scope_description, extracted_text, received_at, sent_at, status")
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId)
      .in("status", ["accepted", "approved"])
      .order("received_at", { ascending: true, nullsFirst: false }),
    admin
      .from("schedule_phases")
      .select("id, start_date, end_date")
      .eq("project_id", projectId)
      .contains("assigned_sub_ids", [subId])
      .order("start_date", { ascending: true, nullsFirst: false }),
    admin
      .from("project_subcontractors")
      .select("contract_amount, scope_summary, contract_locked_at")
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId)
      .maybeSingle(),
    admin.from("projects").select("contract_additional_terms").eq("id", projectId).maybeSingle(),
    admin.rpc("current_estimate_id", { p_project_id: projectId }),
    admin
      .from("sub_agreements")
      .select("id, number, quote_request_ids, estimate_line_item_ids")
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId)
      .eq("kind", "work_order")
      .not("status", "in", "(void,superseded)"),
  ]);

  // What his other live work orders on this job already carry.
  const otherWos = ((otherWosRes.data ?? []) as {
    id: string;
    number: string;
    quote_request_ids: string[] | null;
    estimate_line_item_ids: string[] | null;
  }[]).filter((w) => w.id !== opts.excludeAgreementId);
  const coveredQuotes = new Map<string, string>();
  const coveredLines = new Map<string, string>();
  for (const w of otherWos) {
    for (const q of w.quote_request_ids ?? []) if (!coveredQuotes.has(q)) coveredQuotes.set(q, w.number);
    for (const l of w.estimate_line_item_ids ?? []) if (!coveredLines.has(l)) coveredLines.set(l, w.number);
  }
  const leftOut: string[] = [];

  const allQuotes = (quotesRes.data ?? []) as {
    id: string;
    trade: string | null;
    amount: number | string | null;
    scope_description: string | null;
    extracted_text: string | null;
    received_at: string | null;
    sent_at: string | null;
  }[];
  const quotes = allQuotes.filter((q) => {
    const on = coveredQuotes.get(q.id);
    if (on) {
      const day = shortDay(q.received_at ?? q.sent_at);
      leftOut.push(`Already on ${on}: his quote${day ? ` of ${day}` : ""}, left out.`);
    }
    return !on;
  });

  let scope: string | null = null;
  let price: number | null = null;
  let exclusions: string | null = null;
  let quoteIds: string[] = [];
  let lineIds: string[] = [];

  if (quotes.length) {
    quoteIds = quotes.map((q) => q.id);
    const scopes = quotes.map((q) => q.scope_description?.trim()).filter((s): s is string => !!s);
    scope = scopes.length ? scopes.join("\n\n") : null;
    const amounts = quotes.map((q) => num(q.amount)).filter((n): n is number => n != null);
    price = amounts.length ? roundCents(amounts.reduce((s, n) => s + n, 0)) : null;
    const excl = quotes.map((q) => quoteExclusions(q.extracted_text)).filter((s): s is string => !!s);
    exclusions = excl.length ? excl.join("\n\n") : null;
    const when = quotes.map((q) => shortDay(q.received_at ?? q.sent_at)).filter(Boolean).join(", ");
    sources.push(
      quotes.length === 1
        ? `Scope and price: his accepted quote${when ? ` of ${when}` : ""}, scope word for word.`
        : `Scope and price: his ${quotes.length} accepted quotes${when ? ` (${when})` : ""} added together, scopes word for word.`,
    );
    if (exclusions) sources.push("Exclusions: quoted from his own quote. Check them.");
  }

  if (!allQuotes.length && typeof estimateRes.data === "string") {
    // An award through a bid package: no accepted quote, just the line. The
    // line's own text (proposal_description, scope_text) is the client's
    // proposal wording, allowance amounts and all, so it never goes on a sub
    // agreement. The scope is the bid package he priced, word for word.
    const { data: lines } = await admin
      .from("estimate_line_items")
      .select("id, description, awarded_cost, awarded_bid_id")
      .eq("estimate_id", estimateRes.data)
      .eq("awarded_subcontractor_id", subId)
      .order("sort_order", { ascending: true });
    const allAwarded = (lines ?? []) as {
      id: string;
      description: string | null;
      awarded_cost: number | string | null;
      awarded_bid_id: string | null;
    }[];
    const awarded = allAwarded.filter((l) => {
      const on = coveredLines.get(l.id);
      if (on) leftOut.push(`Already on ${on}: an estimate line awarded to him, left out.`);
      return !on;
    });
    if (awarded.length) {
      lineIds = awarded.map((l) => l.id);
      const bidIds = Array.from(new Set(awarded.map((l) => l.awarded_bid_id).filter((x): x is string => !!x)));
      const { data: bids } = bidIds.length
        ? await admin.from("subcontractor_bids").select("id, extracted_text, bid_package:bid_packages(scope_of_work)").in("id", bidIds)
        : { data: [] };
      type PackageRel = { scope_of_work: string | null };
      const bidRows = (bids ?? []) as { id: string; extracted_text: string | null; bid_package: PackageRel | PackageRel[] | null }[];
      const pkgScopes = Array.from(
        new Set(
          bidRows
            .map((b) => {
              const pkg = Array.isArray(b.bid_package) ? b.bid_package[0] : b.bid_package;
              return (pkg?.scope_of_work ?? "").trim();
            })
            .filter(Boolean),
        ),
      );
      scope = pkgScopes.length ? pkgScopes.join("\n\n") : null;
      const bidExcl = bidRows.map((b) => quoteExclusions(b.extracted_text)).filter((x): x is string => !!x);
      if (bidExcl.length) exclusions = bidExcl.join("\n\n");
      const costs = awarded.map((l) => num(l.awarded_cost)).filter((n): n is number => n != null);
      price = costs.length ? roundCents(costs.reduce((s, n) => s + n, 0)) : null;
      const bidsWord = `his awarded bid${awarded.length === 1 ? "" : "s"} (${awarded.length} estimate line${awarded.length === 1 ? "" : "s"})`;
      sources.push(
        scope
          ? `Scope: the bid package he priced, word for word. Price: ${bidsWord}.`
          : `Scope: nothing sub-facing on file (the awarded lines' text is client proposal wording). Write it. Price: ${bidsWord}.`,
      );
      if (exclusions) sources.push("Exclusions: quoted from his own bid. Check them.");
    }
  }

  if (leftOut.length) sources.push(...leftOut, "Use a sub change order for added work on a signed work order.");
  else if (otherWos.length) sources.push(`He already has ${otherWos.map((w) => w.number).join(", ")} on this job. Make sure this one is new work.`);

  const link = linkRes.data as { contract_amount: number | string | null; scope_summary: string | null; contract_locked_at: string | null } | null;
  if (!scope && link?.scope_summary?.trim()) {
    scope = link.scope_summary.trim();
    sources.push("Scope: the note on his job link.");
  }
  // Once he has another work order here, the job link's amount is the award
  // that one already carries, so it only fills his first.
  if (price == null && !otherWos.length && link && !link.contract_locked_at && num(link.contract_amount) != null && num(link.contract_amount)! > 0) {
    price = num(link.contract_amount);
    sources.push("Price: the amount on his job link.");
  }
  if (!scope) sources.push("Scope: nothing on file. Write it.");
  if (price == null) sources.push("Price: nothing on file. Enter it.");

  const phases = (phasesRes.data ?? []) as { id: string; start_date: string | null; end_date: string | null }[];
  const starts = phases.map((p) => p.start_date).filter((d): d is string => !!d).sort();
  const ends = phases.map((p) => p.end_date ?? p.start_date).filter((d): d is string => !!d).sort();
  if (phases.length) sources.push(`Dates: his ${phases.length} phase${phases.length === 1 ? "" : "s"} on the job.`);

  const terms = toSections((projectRes.data as { contract_additional_terms?: unknown } | null)?.contract_additional_terms);
  const options = terms.map((t) => ({ ...t, checked: flowDownByDefault(t) }));
  if (options.length) {
    sources.push(`Owner and association terms: ${options.filter((o) => o.checked).length} of ${options.length} from the client contract ticked. Check them.`);
  }

  return {
    scope_text: scope,
    exclusions_text: exclusions,
    price_basis: price != null ? "lump_sum" : null,
    price,
    draws: price != null ? [{ label: "On completion", amount: price, percent: 100, when: "When the scope is complete" }] : [],
    start_date: starts[0] ?? null,
    end_date: ends[ends.length - 1] ?? null,
    schedule_phase_ids: phases.map((p) => p.id),
    quote_request_ids: quoteIds,
    estimate_line_item_ids: lineIds,
    additional_terms: options.filter((o) => o.checked).map(({ title, body }) => ({ title, body })),
    flow_down_options: options,
    sources,
  };
}

// ───────────────────────────────────────── what the sub sees

/** A sub never sees a draft, or a void one that was never sent to him. */
export function isVisibleToSub(a: Pick<AgreementRow, "status" | "sent_at" | "signed_on_paper">): boolean {
  if (a.status === "sent" || a.status === "viewed" || a.status === "signed") return true;
  return !!a.sent_at || a.signed_on_paper;
}

export function agreementPdfUrl(id: string): string {
  return `/api/generate-sub-agreement?id=${encodeURIComponent(id)}`;
}

interface SummaryContext {
  mode: SubPortalMode;
  /** R1 logins are always the company owner; R2 workers can't sign. */
  role: "owner" | "worker";
}

/** SubAgreementSummary from a loaded bundle. */
export function toSubAgreementSummary(b: AgreementBundle, ctx: SummaryContext): SubAgreementSummary {
  const a = b.agreement;
  return {
    id: a.id,
    number: a.number,
    kind: a.kind,
    status: a.status,
    project_id: a.project_id,
    project_name: b.project?.name ?? null,
    title: agreementTitle(a.kind, a.number, b.project?.name ?? null),
    parent_number: b.parent?.number ?? null,
    scope_text: a.scope_text,
    price_basis: a.price_basis,
    price: a.price,
    unit_rate: a.unit_rate,
    unit_label: a.unit_label,
    not_to_exceed: a.not_to_exceed,
    sent_at: a.sent_at,
    sub_signed_at: a.sub_signed_at,
    signed_on_paper: a.signed_on_paper,
    void_reason: a.status === "void" ? a.void_reason : null,
    can_sign: ctx.mode === "sub" && ctx.role === "owner" && subSignBlockers(b).length === 0,
    pdf_url: agreementPdfUrl(a.id),
  };
}

/** SubAgreementDetail (the sign sheet) from a loaded bundle. */
export function toSubAgreementDetail(b: AgreementBundle, ctx: SummaryContext): SubAgreementDetail {
  const a = b.agreement;
  return {
    ...toSubAgreementSummary(b, ctx),
    exclusions_text: a.exclusions_text,
    draws: a.draws,
    start_date: a.start_date,
    end_date: a.end_date,
    additional_terms: a.additional_terms,
    master: b.master ? { id: b.master.id, number: b.master.number, sub_signed_at: b.master.sub_signed_at } : null,
    template: {
      id: b.template.id,
      kind: b.template.kind,
      version: b.template.version,
      title: b.template.title,
      status: b.template.status,
      test_only: b.template.test_only,
      sections: b.template.sections,
      acceptance_text: b.template.acceptance_text,
      esign_consent_text: b.template.esign_consent_text,
    },
    penney_signed: a.penney_signed_at
      ? { name: a.penney_signed_name ?? "Penney Construction, Inc.", title: a.penney_signed_title, at: a.penney_signed_at }
      : null,
    sub_signed:
      a.sub_signed_at || a.signed_on_paper
        ? { name: a.sub_signed_name ?? "", at: a.sub_signed_at ?? a.updated_at, on_paper: a.signed_on_paper }
        : null,
    pdf_sha256: a.pdf_sha256,
  };
}

/**
 * His agreements, as list rows, for the portal (and W1's job payload if it
 * wants them): newest first, drafts and never-sent voids left out.
 */
export async function listSubAgreementSummaries(
  admin: DB,
  input: { subId: string; projectId?: string | null; mode: SubPortalMode; role?: "owner" | "worker" },
): Promise<SubAgreementSummary[]> {
  let q = admin
    .from("sub_agreements")
    .select("id, status, sent_at, signed_on_paper")
    .eq("subcontractor_id", input.subId)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(50);
  if (input.projectId) q = q.eq("project_id", input.projectId);
  const { data } = await q;
  const visible = ((data ?? []) as Pick<AgreementRow, "id" | "status" | "sent_at" | "signed_on_paper">[]).filter(isVisibleToSub);
  const bundles = await Promise.all(visible.map((r) => loadAgreementBundle(admin, r.id)));
  return bundles
    .filter((b): b is AgreementBundle => !!b)
    .map((b) => toSubAgreementSummary(b, { mode: input.mode, role: input.role ?? "owner" }));
}

/** The "Review & sign" rows for Today's Needed list. */
export function signAgreementNeededItems(summaries: SubAgreementSummary[]): SubNeededSignAgreement[] {
  return summaries
    .filter((s) => isAwaitingSubSignature(s.status))
    .map((s) => ({
      key: `sign_agreement:${s.id}`,
      kind: "sign_agreement" as const,
      title: `Sign ${AGREEMENT_KIND_LABEL[s.kind].toLowerCase()} ${s.number}`,
      detail: s.project_name,
      action_label: "Review & sign",
      project_id: s.project_id,
      project_name: s.project_name,
      agreement_id: s.id,
      number: s.number,
    }));
}

// ───────────────────────────────────────── storage

export async function readStoredFile(admin: DB, path: string): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from(SUB_DOCUMENTS_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function storeFile(admin: DB, path: string, data: Buffer, contentType: string): Promise<string | null> {
  const { error } = await admin.storage.from(SUB_DOCUMENTS_BUCKET).upload(path, data, { contentType, upsert: true });
  return error ? error.message : null;
}

// ───────────────────────────────────────── the contract lock

/**
 * "Locked by WO-046-01; use a sub change order" when a signed work order has
 * frozen this sub's amount on this job, else null. The award actions ask
 * before writing anything, so a refused award never half-happens (the
 * guard_locked_sub_contract trigger refuses the write regardless). Works with
 * the signed-in client: office roles can read the agreement number.
 */
export async function subContractLockMessage(db: DB, projectId: string, subId: string): Promise<string | null> {
  const { data: link } = await db
    .from("project_subcontractors")
    .select("contract_locked_at, agreement_id")
    .eq("project_id", projectId)
    .eq("subcontractor_id", subId)
    .maybeSingle();
  if (!link?.contract_locked_at) return null;
  let number: string | null = null;
  if (link.agreement_id) {
    const { data: ag } = await db.from("sub_agreements").select("number").eq("id", link.agreement_id).maybeSingle();
    number = (ag?.number as string | undefined) ?? null;
  }
  return `Locked by ${number ?? "a signed work order"}; use a sub change order`;
}

// ───────────────────────────────────────── the Penney signer

/** The signer's own name and title (employees.title, e.g. "Owner"); never a hard-coded "Ryan Penney". */
export async function loadSignerIdentity(
  admin: DB,
  profile: { id: string; email?: string | null; full_name?: string | null },
): Promise<{ id: string; name: string; title: string | null }> {
  const { data: byProfile } = await admin.from("employees").select("title").eq("profile_id", profile.id).limit(1);
  let title = (byProfile ?? [])[0]?.title as string | null | undefined;
  if (!title && profile.email) {
    const { data: byEmail } = await admin.from("employees").select("title").ilike("email", profile.email).limit(1);
    title = (byEmail ?? [])[0]?.title as string | null | undefined;
  }
  return { id: profile.id, name: profile.full_name?.trim() || profile.email || "Penney Construction, Inc.", title: title?.trim() || null };
}
