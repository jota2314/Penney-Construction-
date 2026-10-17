import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isInternalJob } from "@/lib/crew/crew-visibility";
import { addDays, etDate, etStartOfDay, todayET } from "./et-day";
import {
  SUB_ACTIVE_JOB_WINDOWS,
  SUB_AGREEMENT_AWAITING_SIGN,
  SUB_AWARDED_QUOTE_STATUSES,
  isActiveProjectSub,
  isSubLiveStatus,
  subLiveRank,
} from "./statuses";

/**
 * The ONE rule for "is this job on his list" (plan §2.3). Today, Dates,
 * Money, the job screen and the capture routes all ask here, so Marcio's 30
 * jobs padded out of billing history drop to the handful he's really on.
 *
 * A job is his when it's live (SUB_LIVE_STATUSES), it isn't an Office / Shop
 * job (isInternalJob), and at least one of these holds:
 *   - phase:     an assigned phase overlapping −30 … +60 days
 *   - visit:     a check-in there in the last 30 days
 *   - post:      a post or shift of his there in the last 30 days
 *   - bill:      a bill (or a portal invoice) there in the last 60 days
 *   - contract:  an `active` project_subcontractors row
 *   - agreement: a work order sent to him or signed
 *   - award:     an accepted quote or bid, or an awarded estimate line
 *
 * Everything here is read with the service-role client and scoped to his
 * subcontractor id. Membership only; no dollars are decided here.
 */

export type ActiveJobReason = "phase" | "visit" | "post" | "bill" | "contract" | "agreement" | "award";

/** The project columns every sub surface needs. */
export interface SubJobProject {
  id: string;
  name: string;
  project_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  status: string;
  assigned_pm: string | null;
  is_overhead: boolean | null;
}

export const SUB_JOB_PROJECT_COLUMNS = "id, name, project_number, address, city, state, zip, status, assigned_pm, is_overhead";

/** His assigned schedule_phases rows (never `notes`). */
export interface SubPhaseRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  event_type: string | null;
  is_confirmed: boolean | null;
  sub_response: string | null;
  sub_responded_at: string | null;
  sub_response_note: string | null;
  created_by_sub_id: string | null;
  phase_scope: string | null;
  /** Read only to spot a parked "From Estimate" step (isParkedPlanStep); never sent to him. */
  is_manually_scheduled?: boolean | null;
  planned_start_date?: string | null;
}

export const SUB_PHASE_COLUMNS =
  "id, project_id, name, description, start_date, end_date, status, event_type, is_confirmed, sub_response, sub_responded_at, sub_response_note, created_by_sub_id, phase_scope, is_manually_scheduled, planned_start_date";

export interface SubVisitRow {
  id: string;
  project_id: string;
  visit_date: string;
  first_seen_at: string;
  last_seen_at: string;
  first_source: string;
  scans: number;
  posts: number;
  photos: number;
}

/** A post or shift of his, light: no text, just what the lists need. */
export interface SubLogLiteRow {
  id: string;
  project_id: string | null;
  kind: string | null;
  status: string | null;
  started_at: string;
  photo_storage_paths: string[] | null;
}

/** One of his bills to Penney (an `invoices` row). */
export interface SubBillRow {
  id: string;
  project_id: string | null;
  subcontractor_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  description: string | null;
  amount: number | string | null;
  paid_amount: number | string | null;
  payment_status: string | null;
  paid_date: string | null;
  review_status: string | null;
  split_group_id: string | null;
  attachment_storage_path: string | null;
  created_at: string;
}

export const SUB_BILL_COLUMNS =
  "id, project_id, subcontractor_id, invoice_number, invoice_date, description, amount, paid_amount, payment_status, paid_date, review_status, split_group_id, attachment_storage_path, created_at";

/** One sub_bill_submissions row (an invoice he sent from the portal). */
export interface SubSubmissionRow {
  id: string;
  project_id: string | null;
  storage_path: string;
  original_name: string | null;
  mime: string | null;
  size_bytes: number | null;
  ai_read: Record<string, unknown> | null;
  sub_stated_number: string | null;
  sub_stated_amount: number | string | null;
  received_week: string;
  status: string;
  returned_reason: string | null;
  returned_at: string | null;
  created_at: string;
}

export const SUB_SUBMISSION_COLUMNS =
  "id, project_id, storage_path, original_name, mime, size_bytes, ai_read, sub_stated_number, sub_stated_amount, received_week, status, returned_reason, returned_at, created_at";

export interface ProjectSubRow {
  project_id: string;
  contract_amount: number | string | null;
  status: string | null;
  agreement_id: string | null;
  contract_locked_at: string | null;
}

/** His agreements, drafts excluded (a draft is the office's, not his). */
export interface SubAgreementRow {
  id: string;
  number: string;
  kind: string;
  status: string;
  project_id: string | null;
  parent_id: string | null;
  template_id: string;
  scope_text: string | null;
  price_basis: string | null;
  price: number | string | null;
  unit_rate: number | string | null;
  unit_label: string | null;
  not_to_exceed: number | string | null;
  sent_at: string | null;
  sub_signed_at: string | null;
  signed_on_paper: boolean | null;
  void_reason: string | null;
  created_at: string;
}

export const SUB_AGREEMENT_COLUMNS =
  "id, number, kind, status, project_id, parent_id, template_id, scope_text, price_basis, price, unit_rate, unit_label, not_to_exceed, sent_at, sub_signed_at, signed_on_paper, void_reason, created_at";

/** An award: an accepted quote, an accepted bid, or an awarded estimate line. */
export interface SubAwardRow {
  source: "quote" | "bid" | "line";
  id: string;
  project_id: string;
  amount: number | null;
}

/** Everything the rule reads, kept so the loader doesn't fetch it twice. */
export interface SubSignals {
  /** His assigned phases that end on or after today − 30 days, plus undated ones. */
  phases: SubPhaseRow[];
  /** Check-ins in the last 30 days. */
  visits: SubVisitRow[];
  /** Posts and shifts in the last 30 days. */
  logs: SubLogLiteRow[];
  /** All his bills (they also feed Money). */
  bills: SubBillRow[];
  /** Portal invoices from the last 90 days. */
  submissions: SubSubmissionRow[];
  projectSubs: ProjectSubRow[];
  agreements: SubAgreementRow[];
  awards: SubAwardRow[];
}

export interface SubActiveJobs {
  today: string;
  /** Active project ids, live jobs first (in_progress, contracted, on_hold), then by name. */
  ids: string[];
  /** Why each active job is on his list. */
  reasons: Map<string, ActiveJobReason[]>;
  /** Every project any signal touches (names for Money), active or not. */
  projects: Map<string, SubJobProject>;
  signals: SubSignals;
}

const W = SUB_ACTIVE_JOB_WINDOWS;
const SUBMISSION_DAYS = 90;
// Agreements that keep a job on his list: sent to him, opened, or signed.
const LISTING_AGREEMENT_STATUSES = [...SUB_AGREEMENT_AWAITING_SIGN, "signed"];

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Does a phase overlap the −30 … +60 day window around today? Undated phases don't count. */
export function phaseInWindow(p: { start_date: string | null; end_date: string | null }, today: string): boolean {
  if (!p.start_date) return false;
  const last = p.end_date && p.end_date >= p.start_date ? p.end_date : p.start_date;
  return p.start_date <= addDays(today, W.phaseFutureDays) && last >= addDays(today, -W.phasePastDays);
}

/** The day a bill counts from: its invoice date, else the day it was entered. */
function billDay(b: { invoice_date: string | null; created_at: string }): string | null {
  return b.invoice_date || etDate(b.created_at);
}

/**
 * Load every signal for one sub in one parallel batch. Exported for the
 * loader; other server code should call getSubActiveProjectIds / isSubOnJob.
 */
export async function loadSubSignals(supabase: SupabaseClient, subId: string, today: string): Promise<SubSignals> {
  const phaseFloor = addDays(today, -W.phasePastDays);
  const activityFloor = addDays(today, -W.activityDays);
  const submissionsSince = etStartOfDay(addDays(today, -SUBMISSION_DAYS)).toISOString();

  const [phases, visits, logs, bills, submissions, projectSubs, agreements, quotes, bids, lines] = await Promise.all([
    supabase
      .from("schedule_phases")
      .select(SUB_PHASE_COLUMNS)
      .contains("assigned_sub_ids", [subId])
      .or(`end_date.gte.${phaseFloor},and(end_date.is.null,start_date.gte.${phaseFloor}),start_date.is.null`)
      .order("start_date", { ascending: true, nullsFirst: false })
      .limit(500),
    supabase
      .from("sub_site_visits")
      .select("id, project_id, visit_date, first_seen_at, last_seen_at, first_source, scans, posts, photos")
      .eq("subcontractor_id", subId)
      .gte("visit_date", activityFloor)
      .order("last_seen_at", { ascending: false })
      .limit(500),
    supabase
      .from("daily_logs")
      .select("id, project_id, kind, status, started_at, photo_storage_paths")
      .eq("subcontractor_id", subId)
      .gte("started_at", etStartOfDay(activityFloor).toISOString())
      .order("started_at", { ascending: false })
      .limit(500),
    supabase
      .from("invoices")
      .select(SUB_BILL_COLUMNS)
      .eq("subcontractor_id", subId)
      .order("invoice_date", { ascending: false, nullsFirst: false })
      .limit(1000),
    supabase
      .from("sub_bill_submissions")
      .select(SUB_SUBMISSION_COLUMNS)
      .eq("subcontractor_id", subId)
      .gte("created_at", submissionsSince)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("project_subcontractors")
      .select("project_id, contract_amount, status, agreement_id, contract_locked_at")
      .eq("subcontractor_id", subId),
    supabase
      .from("sub_agreements")
      .select(SUB_AGREEMENT_COLUMNS)
      .eq("subcontractor_id", subId)
      .neq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("quote_requests")
      .select("id, project_id, amount")
      .eq("subcontractor_id", subId)
      .in("status", [...SUB_AWARDED_QUOTE_STATUSES])
      .not("project_id", "is", null),
    supabase
      .from("subcontractor_bids")
      .select("id, amount, bid_packages!inner(project_id)")
      .eq("subcontractor_id", subId)
      .eq("status", "accepted"),
    supabase
      .from("estimate_line_items")
      .select("id, awarded_cost, estimates!inner(project_id, is_option)")
      .eq("awarded_subcontractor_id", subId),
  ]);

  const awards: SubAwardRow[] = [];
  for (const q of (quotes.data ?? []) as { id: string; project_id: string; amount: number | string | null }[]) {
    awards.push({ source: "quote", id: q.id, project_id: q.project_id, amount: num(q.amount) });
  }
  for (const b of (bids.data ?? []) as { id: string; amount: number | string | null; bid_packages: unknown }[]) {
    const pid = one(b.bid_packages as { project_id: string | null } | { project_id: string | null }[])?.project_id;
    if (pid) awards.push({ source: "bid", id: b.id, project_id: pid, amount: num(b.amount) });
  }
  for (const l of (lines.data ?? []) as { id: string; awarded_cost: number | string | null; estimates: unknown }[]) {
    const est = one(l.estimates as { project_id: string | null; is_option: boolean | null } | { project_id: string | null; is_option: boolean | null }[]);
    // An option estimate's award isn't the job's contract.
    if (est?.project_id && !est.is_option) awards.push({ source: "line", id: l.id, project_id: est.project_id, amount: num(l.awarded_cost) });
  }

  return {
    phases: (phases.data ?? []) as SubPhaseRow[],
    visits: (visits.data ?? []) as SubVisitRow[],
    logs: (logs.data ?? []) as SubLogLiteRow[],
    bills: (bills.data ?? []) as SubBillRow[],
    submissions: (submissions.data ?? []) as SubSubmissionRow[],
    projectSubs: (projectSubs.data ?? []) as ProjectSubRow[],
    agreements: (agreements.data ?? []) as SubAgreementRow[],
    awards,
  };
}

/** Why a job is on his list under the rule (empty = it isn't). Status and internal checks are separate. */
export function activeReasons(projectId: string, s: SubSignals, today: string): ActiveJobReason[] {
  const reasons: ActiveJobReason[] = [];
  const billFloor = addDays(today, -W.billDays);
  if (s.phases.some((p) => p.project_id === projectId && phaseInWindow(p, today))) reasons.push("phase");
  if (s.visits.some((v) => v.project_id === projectId)) reasons.push("visit");
  if (s.logs.some((l) => l.project_id === projectId)) reasons.push("post");
  if (
    s.bills.some((b) => b.project_id === projectId && (billDay(b) ?? "") >= billFloor) ||
    s.submissions.some((x) => x.project_id === projectId && (etDate(x.created_at) ?? "") >= billFloor)
  ) {
    reasons.push("bill");
  }
  if (s.projectSubs.some((ps) => ps.project_id === projectId && isActiveProjectSub(ps.status))) reasons.push("contract");
  if (s.agreements.some((a) => a.project_id === projectId && LISTING_AGREEMENT_STATUSES.includes(a.status))) reasons.push("agreement");
  if (s.awards.some((a) => a.project_id === projectId)) reasons.push("award");
  return reasons;
}

/** Is this project one a sub's list can hold at all: live and not an Office / Shop job. */
export function isListableProject(p: SubJobProject | null | undefined): p is SubJobProject {
  return !!p && isSubLiveStatus(p.status) && !isInternalJob(p);
}

/**
 * His active jobs, with the signals behind them. The sub-portal loader builds
 * Today, Dates and Money from this one read.
 */
export async function getSubActiveJobs(
  supabase: SupabaseClient,
  subId: string,
  opts: { today?: string } = {},
): Promise<SubActiveJobs> {
  const today = opts.today ?? todayET();
  const signals = await loadSubSignals(supabase, subId, today);

  const ids = new Set<string>();
  const add = (id: string | null | undefined) => id && ids.add(id);
  signals.phases.forEach((r) => add(r.project_id));
  signals.visits.forEach((r) => add(r.project_id));
  signals.logs.forEach((r) => add(r.project_id));
  signals.bills.forEach((r) => add(r.project_id));
  signals.submissions.forEach((r) => add(r.project_id));
  signals.projectSubs.forEach((r) => add(r.project_id));
  signals.agreements.forEach((r) => add(r.project_id));
  signals.awards.forEach((r) => add(r.project_id));

  const projects = new Map<string, SubJobProject>();
  const all = Array.from(ids);
  // Chunked so a long billing history can't overrun the URL.
  for (let i = 0; i < all.length; i += 150) {
    const { data } = await supabase.from("projects").select(SUB_JOB_PROJECT_COLUMNS).in("id", all.slice(i, i + 150));
    for (const p of (data ?? []) as SubJobProject[]) projects.set(p.id, p);
  }

  const reasons = new Map<string, ActiveJobReason[]>();
  for (const p of projects.values()) {
    if (!isListableProject(p)) continue;
    const why = activeReasons(p.id, signals, today);
    if (why.length) reasons.set(p.id, why);
  }

  const active = Array.from(reasons.keys()).sort((a, b) => {
    const pa = projects.get(a)!;
    const pb = projects.get(b)!;
    return subLiveRank(pa.status) - subLiveRank(pb.status) || pa.name.localeCompare(pb.name);
  });

  return { today, ids: active, reasons, projects, signals };
}

/** His active project ids under the one rule (see the file comment). */
export async function getSubActiveProjectIds(
  supabase: SupabaseClient,
  subId: string,
  opts: { today?: string } = {},
): Promise<string[]> {
  return (await getSubActiveJobs(supabase, subId, opts)).ids;
}

/**
 * Is this one job on his list right now? The capture routes (post, photo,
 * clock, inspections) and the QR arrive check ask this before writing. Same
 * rule as getSubActiveProjectIds, read for one project with head counts.
 *
 * `assignedOnly`: count only what the office creates (an assigned phase, a
 * bill it filed, an active job link, a sent/signed agreement, an awarded
 * quote, bid or line), not what he can make on his own (a QR visit, a post
 * or shift, a portal invoice). Inspection Passed/Failed needs this, so a QR
 * sign-up can't mark a rough passed by picking a trade.
 */
export async function isSubOnJob(
  supabase: SupabaseClient,
  subId: string,
  projectId: string,
  opts: { today?: string; assignedOnly?: boolean } = {},
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return false;
  const today = opts.today ?? todayET();
  const phaseFloor = addDays(today, -W.phasePastDays);
  const phaseCeil = addDays(today, W.phaseFutureDays);
  const activityFloor = addDays(today, -W.activityDays);
  const billFloor = addDays(today, -W.billDays);
  const billFloorTs = etStartOfDay(billFloor).toISOString();
  const head = { count: "exact" as const, head: true };

  const [project, ...counts] = await Promise.all([
    supabase.from("projects").select(SUB_JOB_PROJECT_COLUMNS).eq("id", projectId).maybeSingle(),
    supabase
      .from("schedule_phases")
      .select("id", head)
      .eq("project_id", projectId)
      .contains("assigned_sub_ids", [subId])
      .lte("start_date", phaseCeil)
      .or(`end_date.gte.${phaseFloor},and(end_date.is.null,start_date.gte.${phaseFloor})`),
    supabase
      .from("sub_site_visits")
      .select("id", head)
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId)
      .gte("visit_date", activityFloor),
    supabase
      .from("daily_logs")
      .select("id", head)
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId)
      .gte("started_at", etStartOfDay(activityFloor).toISOString()),
    supabase
      .from("invoices")
      .select("id", head)
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId)
      .or(`invoice_date.gte.${billFloor},and(invoice_date.is.null,created_at.gte."${billFloorTs}")`),
    supabase
      .from("sub_bill_submissions")
      .select("id", head)
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId)
      .gte("created_at", billFloorTs),
    supabase
      .from("project_subcontractors")
      .select("id", head)
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId)
      .or("status.eq.active,status.is.null"),
    supabase
      .from("sub_agreements")
      .select("id", head)
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId)
      .in("status", LISTING_AGREEMENT_STATUSES),
    supabase
      .from("quote_requests")
      .select("id", head)
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId)
      .in("status", [...SUB_AWARDED_QUOTE_STATUSES]),
    supabase
      .from("subcontractor_bids")
      .select("id, bid_packages!inner(project_id)", head)
      .eq("subcontractor_id", subId)
      .eq("status", "accepted")
      .eq("bid_packages.project_id", projectId),
    supabase
      .from("estimate_line_items")
      .select("id, estimates!inner(project_id, is_option)", head)
      .eq("awarded_subcontractor_id", subId)
      .eq("estimates.project_id", projectId)
      .or("is_option.is.null,is_option.eq.false", { referencedTable: "estimates" }),
  ]);

  if (!isListableProject(project.data as SubJobProject | null)) return false;
  const [phases, visits, logs, bills, submissions, projectSubs, agreements, quotes, bids, lines] = counts;
  // Signals only the office can create; visits, logs and portal submissions are his own.
  const officeMade = [phases, bills, projectSubs, agreements, quotes, bids, lines];
  const consider = opts.assignedOnly ? officeMade : [...officeMade, visits, logs, submissions];
  return consider.some((c) => (c.count ?? 0) > 0);
}

/**
 * Can he open this job's screen, and post there? `view`: his active jobs,
 * plus any job he has billed (so a Money "By job" row always opens, even
 * after the job closes). Office / Shop jobs never. `post`: isSubOnJob, the
 * same rule the capture routes (post, clock in, inspections) apply, so a
 * job he only billed opens read-only.
 */
export async function canSubViewJob(
  supabase: SupabaseClient,
  subId: string,
  projectId: string,
  opts: { today?: string } = {},
): Promise<{ view: boolean; post: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return { view: false, post: false };
  const head = { count: "exact" as const, head: true };
  const [onJob, project, bills, submissions] = await Promise.all([
    isSubOnJob(supabase, subId, projectId, opts),
    supabase.from("projects").select(SUB_JOB_PROJECT_COLUMNS).eq("id", projectId).maybeSingle(),
    supabase.from("invoices").select("id", head).eq("project_id", projectId).eq("subcontractor_id", subId),
    supabase.from("sub_bill_submissions").select("id", head).eq("project_id", projectId).eq("subcontractor_id", subId),
  ]);
  if (onJob) return { view: true, post: true };
  const p = project.data as SubJobProject | null;
  if (!p || isInternalJob(p)) return { view: false, post: false };
  return { view: (bills.count ?? 0) > 0 || (submissions.count ?? 0) > 0, post: false };
}
