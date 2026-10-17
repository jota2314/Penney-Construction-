import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { cachedSignedUrls } from "@/lib/storage/signed-url-cache";
import { signThumbUrls } from "@/lib/image/transform-signed-url";
import { drawingRevision, fieldVisibleFiles, isInternalJob } from "@/lib/crew/crew-visibility";
import { roundCents } from "@/lib/money";
import { subDoesInspection, tradeForPhaseName } from "@/lib/schedule/trade-keywords";
import { isParkedPlanStep } from "@/lib/schedule/parked";
import { listSubAgreementSummaries, signAgreementNeededItems } from "@/lib/subs/agreements";
import { fmtRange, fmtRelativeDay, fmtShort, fmtTime, fmtWeekday, fmtWeekdayRange, weekOf } from "@/lib/portal-kit/format";
import { addDays, coversDay, etDate, etMonday, etParts, isAfterET, todayET } from "./et-day";
import { countsTowardOwed, isAwaitingSubSignature, isAwardedQuoteStatus, subQuoteStage } from "./statuses";
import { subAgreementsEnabled, subBillsEnabled } from "./flags";
import {
  SUB_BILL_COLUMNS,
  SUB_JOB_PROJECT_COLUMNS,
  SUB_PHASE_COLUMNS,
  SUB_SUBMISSION_COLUMNS,
  canSubViewJob,
  getSubActiveJobs,
  isListableProject,
  isSubOnJob,
  type ProjectSubRow,
  type SubAgreementRow,
  type SubAwardRow,
  type SubBillRow,
  type SubJobProject,
  type SubLogLiteRow,
  type SubPhaseRow,
  type SubSubmissionRow,
  type SubVisitRow,
} from "./active-jobs";
import type {
  SubAgreedAmount,
  SubAgreementSummary,
  SubBillAiRead,
  SubBillSubmissionSummary,
  SubClockState,
  SubComposerContext,
  SubDateBucket,
  SubDatePhase,
  SubDocument,
  SubDocumentGroup,
  SubFileGroup,
  SubHomePayload,
  SubIdentity,
  SubInspection,
  SubInviteChannel,
  SubInvoiceAllocation,
  SubInvoiceGroup,
  SubJobContact,
  SubJobGroups,
  SubJobPayload,
  SubJobPhaseRef,
  SubJobRow,
  SubMoneyByJob,
  SubMoneyPayload,
  SubNeededItem,
  SubPhaseStatus,
  SubPhoto,
  SubPortalFlags,
  SubPortalMode,
  SubPost,
  SubPostsPage,
  SubPreviewMeta,
  SubQuote,
  SubScopeLine,
  SubSelection,
  SubVisitSource,
  SubVisitSummary,
} from "./payload";

/**
 * Everything the v3 sub portal shows, built on the server (plan §2.3).
 *
 *   loadSubHome → GET /api/sub-portal and the staff preview: Today, Dates,
 *                 Money and Needed. Light on purpose: no posts, no photos.
 *   loadSubJob  → GET /api/sub-portal/job/[id]: one job, loaded when he opens
 *                 it, with his company's posts 20 at a time.
 *
 * Both read with the service-role client and scope every row to his
 * subcontractor id: his phases, his posts, his own bills and quotes. Never
 * client pricing, markup, allowances, crew notes or another sub's numbers.
 * Both are read-only: the view counter is the real GET route's job, and a
 * preview never writes anything.
 */

const OFFICE_PHONE = "978-621-4387";
const SIGN_TTL = 60 * 60 * 4;
const PHOTO_BUCKET = "daily-log-photos";
const QUOTE_BUCKET = "email-attachments";
const THUMB_BOX = 640;
const POSTS_PAGE = 20;
// What a sub may open from the project file cabinet (same list as v2). The
// crew filter (fieldVisibleFiles) runs on top; never a second filter.
const SUB_FILE_CATEGORIES = ["construction_drawings", "specs", "permits"];
// The latest client Design Presentation and Fixture & Finish Selections sheet
// (Jorge 10/16) file under drawings or specs; they read as their own group.
const DESIGN_NAME = /design|selection|fixture|finish[\s_-]*schedule|rendering/i;
// The view counter only means "the sub looked" from the v3 deploy on; before
// it, office previews bumped it too.
const VIEW_FIX_DAY = "2026-10-17";
// The "add today's photos" nudge.
const ADD_PHOTOS_AFTER_HOUR = 15;
const LOOM_SETTING = "sub_portal_loom_url";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ───────────────────────────────────────── small helpers

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const cents = (v: number | string | null | undefined): number => roundCents(num(v) ?? 0);
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const firstWord = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0] || null;

/** His directory trades, lowercased and de-duplicated ("Demolition" and "demolition" are one). */
function normalizeTrades(trades: unknown): string[] {
  const list = Array.isArray(trades) ? trades : [];
  return Array.from(new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean)));
}

/** "12 Elm St, Peabody, MA 01960" from the project's address parts. */
function oneLineAddress(p: Pick<SubJobProject, "address" | "city" | "state" | "zip">): string {
  const cityState = [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [p.address, cityState].filter(Boolean).join(", ");
}

function directionsUrl(address: string): string | null {
  return address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : null;
}

const VISIT_SOURCES: readonly string[] = ["qr", "post", "clock", "office"];

function visitSummary(v: SubVisitRow, projectName: string): SubVisitSummary {
  return {
    id: v.id,
    project_id: v.project_id,
    project_name: projectName,
    visit_date: v.visit_date,
    first_seen_at: v.first_seen_at,
    last_seen_at: v.last_seen_at,
    first_source: (VISIT_SOURCES.includes(v.first_source) ? v.first_source : "office") as SubVisitSource,
    scans: v.scans ?? 0,
    posts: v.posts ?? 0,
    photos: v.photos ?? 0,
  };
}

/** A post, or a shift that carries words or photos. A bare clock-out isn't one. */
function isPostLike(l: { kind: string | null; photo_storage_paths: string[] | null; text?: string | null }): boolean {
  if (l.kind !== "shift") return true;
  return (l.photo_storage_paths?.length ?? 0) > 0 || !!l.text?.trim();
}

/** Sign storage paths per bucket through the shared cache; "bucket/path" → URL. */
async function signAll(
  supabase: SupabaseClient,
  refs: { bucket: string; path: string | null | undefined }[],
): Promise<Map<string, string>> {
  const byBucket = new Map<string, string[]>();
  for (const r of refs) {
    if (!r.path) continue;
    byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r.path]);
  }
  const out = new Map<string, string>();
  await Promise.all(
    Array.from(byBucket.entries()).map(async ([bucket, paths]) => {
      const { data } = await cachedSignedUrls(supabase, bucket, paths, SIGN_TTL);
      for (const s of data) out.set(`${bucket}/${s.path}`, s.signedUrl);
    }),
  );
  return out;
}

// ───────────────────────────────────────── shared reads

async function loadOpenShift(supabase: SupabaseClient, subId: string): Promise<SubClockState | null> {
  const { data } = await supabase
    .from("daily_logs")
    .select("id, project_id, started_at, project:projects!project_id(name)")
    .eq("subcontractor_id", subId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.project_id) return null;
  const project = one(data.project as { name: string } | { name: string }[] | null);
  return {
    log_id: data.id as string,
    project_id: data.project_id as string,
    project_name: project?.name ?? "Job",
    started_at: data.started_at as string,
  };
}

async function loadLoomUrl(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", LOOM_SETTING).maybeSingle();
  const url = String(data?.value ?? "").trim();
  return /^https:\/\//i.test(url) ? url : null;
}

/**
 * Invoices filed from his portal submissions, found by the file they were
 * filed with ("filed" is never stored; plan §4.7). A filed bill BillDrop left
 * without a subcontractor id still counts as his; one filed to another sub
 * is ignored.
 */
async function loadFiledBills(
  supabase: SupabaseClient,
  subId: string,
  submissions: SubSubmissionRow[],
): Promise<Map<string, SubBillRow[]>> {
  const paths = Array.from(new Set(submissions.map((s) => s.storage_path).filter(Boolean)));
  const byPath = new Map<string, SubBillRow[]>();
  if (!paths.length) return byPath;
  const { data } = await supabase.from("invoices").select(SUB_BILL_COLUMNS).in("attachment_storage_path", paths);
  for (const b of (data ?? []) as SubBillRow[]) {
    if (b.subcontractor_id && b.subcontractor_id !== subId) continue;
    const key = b.attachment_storage_path as string;
    byPath.set(key, [...(byPath.get(key) ?? []), b]);
  }
  return byPath;
}

/** His bills plus any filed-from-portal bills not already among them. */
function mergeFiled(bills: SubBillRow[], filedByPath: Map<string, SubBillRow[]>): SubBillRow[] {
  const seen = new Set(bills.map((b) => b.id));
  const out = [...bills];
  for (const rows of filedByPath.values()) {
    for (const b of rows) {
      if (!seen.has(b.id)) {
        seen.add(b.id);
        out.push(b);
      }
    }
  }
  return out;
}

// ───────────────────────────────────────── dates

const PHASE_STATUSES: readonly string[] = ["not_started", "in_progress", "completed", "on_hold"];

function dateBucket(start: string | null, end: string | null, today: string): SubDateBucket {
  if (!start) return "unscheduled";
  const last = end && end >= start ? end : start;
  if (last < today) return "past";
  const monday = etMonday(today);
  if (start <= addDays(monday, 6)) return "this_week";
  if (start <= addDays(monday, 13)) return "next_week";
  return "later";
}

/**
 * One timeline row. `assigned` is false for an inspection milestone on his
 * job that he's not on (shown so he knows the date, never asked to answer).
 * No notes ever leave here.
 */
function toDatePhase(
  p: Omit<SubPhaseRow, "sub_response" | "sub_responded_at" | "sub_response_note" | "created_by_sub_id"> &
    Partial<Pick<SubPhaseRow, "sub_response" | "sub_responded_at" | "sub_response_note" | "created_by_sub_id">>,
  projectName: string,
  subId: string,
  today: string,
  assigned: boolean,
): SubDatePhase {
  const mine = assigned && p.created_by_sub_id === subId;
  const isConfirmed = !!p.is_confirmed;
  const response = assigned && (p.sub_response === "confirmed" || p.sub_response === "declined") ? p.sub_response : null;
  // A "From Estimate" step parked on its placeholder day has no real date
  // yet: it reads "Date to be set", never a fake penciled day.
  const parked = isParkedPlanStep(p);
  const bucket = parked ? "unscheduled" : dateBucket(p.start_date, p.end_date, today);
  return {
    id: p.id,
    project_id: p.project_id,
    project_name: projectName,
    name: p.name,
    description: p.description ?? null,
    start_date: parked ? null : p.start_date,
    end_date: parked ? null : p.end_date,
    status: (PHASE_STATUSES.includes(p.status ?? "") ? p.status : "not_started") as SubPhaseStatus,
    event_type: p.event_type ?? null,
    is_confirmed: isConfirmed,
    firm: isConfirmed || mine,
    sub_response: response,
    sub_responded_at: assigned ? (p.sub_responded_at ?? null) : null,
    sub_response_note: assigned ? (p.sub_response_note ?? null) : null,
    mine,
    // A finished date isn't worth answering; it would sit in the badge forever.
    needs_answer: assigned && isConfirmed && !response && !mine && bucket !== "past",
    bucket,
  };
}

function byStartDate(a: SubDatePhase, b: SubDatePhase): number {
  if (!a.start_date !== !b.start_date) return a.start_date ? -1 : 1;
  return (a.start_date ?? "").localeCompare(b.start_date ?? "") || a.name.localeCompare(b.name);
}

/**
 * Inspection milestones on his live jobs that match one of his trades but
 * aren't assigned to him ("Rough plumbing inspection" for the plumber), so
 * Dates shows when the inspector comes.
 */
async function loadTradeMilestones(
  supabase: SupabaseClient,
  projectIds: string[],
  trades: string[],
  subId: string,
  today: string,
): Promise<SubPhaseRow[]> {
  if (!projectIds.length || !trades.length) return [];
  const floor = addDays(today, -30);
  const { data } = await supabase
    .from("schedule_phases")
    .select(`${SUB_PHASE_COLUMNS}, assigned_sub_ids`)
    .in("project_id", projectIds)
    .eq("event_type", "inspection")
    .or(`end_date.gte.${floor},and(end_date.is.null,start_date.gte.${floor}),start_date.is.null`)
    .limit(300);
  // Master milestones only; a daily crew row is internal.
  return ((data ?? []) as (SubPhaseRow & { assigned_sub_ids: string[] | null })[]).filter(
    (p) =>
      p.phase_scope !== "daily" && !(p.assigned_sub_ids ?? []).includes(subId) && subDoesInspection(trades, p.name),
  );
}

// ───────────────────────────────────────── jobs

/** "Demo · Mon–Tue (penciled in)", "Tile · Today–Fri", "Framing · Week of Oct 26 (penciled in)". */
function phaseWhen(p: { start_date: string; end_date: string | null; firm: boolean }, today: string): string {
  const start = p.start_date;
  const end = p.end_date && p.end_date >= start ? p.end_date : start;
  const soon = addDays(today, 6);
  let when: string;
  if (start <= today && today <= end) {
    when = end === today ? "Today" : end <= soon ? `Today–${fmtWeekday(end)}` : `Through ${fmtShort(end)}`;
  } else if (start <= soon && end <= soon) {
    when = fmtWeekdayRange(start, end);
  } else {
    when = p.firm ? fmtRange(start, end) : weekOf(start);
  }
  return p.firm ? when : `${when} (penciled in)`;
}

function phaseRef(p: SubPhaseRow, subId: string): SubJobPhaseRef {
  return {
    id: p.id,
    name: p.name,
    start_date: p.start_date,
    end_date: p.end_date,
    firm: !!p.is_confirmed || p.created_by_sub_id === subId,
  };
}

interface JobRowInput {
  project: SubJobProject;
  phases: SubPhaseRow[];
  visits: SubVisitRow[];
  logs: SubLogLiteRow[];
  awaitingAgreement: boolean;
  subId: string;
  today: string;
}

function buildJobRow({ project, phases, visits, logs, awaitingAgreement, subId, today }: JobRowInput): SubJobRow {
  // A parked "From Estimate" step's placeholder day never makes a job Today or This week.
  const dated = phases.filter((p) => !!p.start_date && !isParkedPlanStep(p));
  // Today's phase: confirmed before penciled, then the one that started last.
  const covering = dated
    .filter((p) => coversDay(p.start_date, p.end_date, today))
    .sort((a, b) => Number(!!b.is_confirmed) - Number(!!a.is_confirmed) || (b.start_date ?? "").localeCompare(a.start_date ?? ""))[0];
  const next = dated
    .filter((p) => (p.start_date as string) > today && (p.start_date as string) <= addDays(today, 60))
    .sort((a, b) => (a.start_date as string).localeCompare(b.start_date as string))[0];
  const phase = covering ?? next ?? null;

  const visitToday = visits.find((v) => v.visit_date === today) ?? null;
  // A post or clock-in also makes a visit row (scans 0): it counts as today's
  // activity, but only his own QR scan says he's here (plan §2.1).
  const scannedToday = !!visitToday && (visitToday.scans ?? 0) > 0;
  const posts = logs.filter((l) => isPostLike(l));
  const postsToday = posts.filter((l) => etDate(l.started_at) === today);
  const lastPost = posts[0]?.started_at ?? null; // logs arrive newest first
  const lastVisit = visits[0]?.last_seen_at ?? null;
  const activity = [lastPost, lastVisit, logs[0]?.started_at ?? null].filter((t): t is string => !!t).sort().pop() ?? null;

  const bucket =
    covering || visitToday || postsToday.length
      ? "today"
      : next && (next.start_date as string) <= addDays(today, 7)
        ? "this_week"
        : "other";

  let summary: string;
  if (phase) {
    const ref = phaseRef(phase, subId);
    summary = `${phase.name} · ${phaseWhen({ start_date: phase.start_date as string, end_date: phase.end_date, firm: ref.firm }, today)}`;
  } else if (postsToday.length) {
    summary = `Posted today · ${plural(postsToday.length, "post")}`;
  } else if (scannedToday && visitToday) {
    summary = `Checked in ${fmtTime(visitToday.first_seen_at)}`;
  } else if (lastPost) {
    summary = `Last post ${fmtRelativeDay(lastPost, today)}`;
  } else if (lastVisit) {
    summary = `Last here ${fmtRelativeDay(lastVisit, today)}`;
  } else if (awaitingAgreement) {
    summary = "Work order to review";
  } else {
    summary = "No dates yet";
  }

  return {
    project_id: project.id,
    name: project.name,
    project_number: project.project_number ?? "",
    town: project.city ?? null,
    address: oneLineAddress(project),
    status: project.status,
    bucket,
    summary,
    phase: phase ? phaseRef(phase, subId) : null,
    last_activity_at: activity,
    here_now: scannedToday,
  };
}

function groupJobs(rows: SubJobRow[]): SubJobGroups {
  const start = (r: SubJobRow) => r.phase?.start_date ?? "9999-12-31";
  const today = rows
    .filter((r) => r.bucket === "today")
    .sort((a, b) => Number(b.here_now) - Number(a.here_now) || start(a).localeCompare(start(b)) || a.name.localeCompare(b.name));
  const thisWeek = rows
    .filter((r) => r.bucket === "this_week")
    .sort((a, b) => start(a).localeCompare(start(b)) || a.name.localeCompare(b.name));
  const other = rows
    .filter((r) => r.bucket === "other")
    .sort(
      (a, b) =>
        (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? "") ||
        start(a).localeCompare(start(b)) ||
        a.name.localeCompare(b.name),
    );
  return { today, this_week: thisWeek, other };
}

// ───────────────────────────────────────── money

/**
 * One bill's numbers, to the cent. A bill marked paid counts as fully paid
 * (a few rows carry payment_status 'paid' with paid_amount short or 0), and
 * an overpayment is "already paid", never a credit: open never goes below 0.
 */
function billMoney(b: SubBillRow): { amount: number; paid: number; open: number } {
  const amount = cents(b.amount);
  const paidRaw = cents(b.paid_amount);
  const paid = b.payment_status === "paid" ? Math.max(paidRaw, amount) : paidRaw;
  return { amount, paid: roundCents(paid), open: roundCents(Math.max(0, amount - paid)) };
}

const normNumber = (n: string | null | undefined) => (n ?? "").trim().replace(/^#\s*/, "").toLowerCase();

/** His bills grouped the way he sent them: one row per invoice number, the job splits underneath. */
function groupBills(bills: SubBillRow[], projectName: (id: string | null) => string | null): SubInvoiceGroup[] {
  const groups = new Map<string, SubBillRow[]>();
  for (const b of bills) {
    const number = normNumber(b.invoice_number);
    const key = number ? `inv:${number}` : b.split_group_id ? `split:${b.split_group_id}` : `bill:${b.id}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  return Array.from(groups.entries()).map(([key, rows]) => {
    const allocations: SubInvoiceAllocation[] = rows
      .map((b) => ({
        bill_id: b.id,
        project_id: b.project_id,
        project_name: projectName(b.project_id),
        description: b.description ?? null,
        ...billMoney(b),
      }))
      .sort((a, b) => (a.project_name ?? "").localeCompare(b.project_name ?? ""));
    const amount = roundCents(allocations.reduce((s, a) => s + a.amount, 0));
    const paid = roundCents(allocations.reduce((s, a) => s + a.paid, 0));
    const open = roundCents(allocations.reduce((s, a) => s + a.open, 0));
    const allPaid = rows.every((b) => b.payment_status === "paid");
    // First match wins (payload.ts): paid beats needs_review.
    const status = open <= 0 || allPaid ? "paid" : rows.some((b) => b.review_status === "needs_review") ? "with_penney" : "owed";
    const dates = rows.map((b) => b.invoice_date || etDate(b.created_at)).filter((d): d is string => !!d).sort();
    const paidDates = rows.map((b) => b.paid_date).filter((d): d is string => !!d).sort();
    const number = rows.find((b) => b.invoice_number?.trim())?.invoice_number?.trim() ?? null;
    return {
      key,
      invoice_number: number,
      date: dates[0] ?? null,
      amount,
      paid,
      open,
      status,
      paid_date: status === "paid" ? (paidDates[paidDates.length - 1] ?? null) : null,
      returned_reason: null,
      source: "bill" as const,
      allocations,
    } satisfies SubInvoiceGroup;
  });
}

function aiRead(raw: Record<string, unknown> | null): SubBillAiRead | null {
  if (!raw || typeof raw !== "object") return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const amount = num(raw.amount as number | string | null);
  return {
    invoice_number: str(raw.invoice_number),
    amount: amount == null ? null : roundCents(amount),
    invoice_date: str(raw.invoice_date),
    vendor_name: str(raw.vendor_name),
    project_hint: str(raw.project_hint),
  };
}

function submissionSummary(
  s: SubSubmissionRow,
  filedByPath: Map<string, SubBillRow[]>,
  projectName: (id: string | null) => string | null,
): SubBillSubmissionSummary {
  const filedRows = filedByPath.get(s.storage_path) ?? [];
  let filed: SubBillSubmissionSummary["filed"] = null;
  if (filedRows.length) {
    const m = filedRows.map(billMoney);
    filed = {
      bill_id: filedRows[0].id,
      invoice_number: filedRows.find((b) => b.invoice_number?.trim())?.invoice_number?.trim() ?? null,
      amount: roundCents(m.reduce((t, x) => t + x.amount, 0)),
      paid: roundCents(m.reduce((t, x) => t + x.paid, 0)),
      open: roundCents(m.reduce((t, x) => t + x.open, 0)),
    };
  }
  const stated = num(s.sub_stated_amount);
  return {
    id: s.id,
    project_id: s.project_id,
    project_name: projectName(s.project_id),
    original_name: s.original_name,
    mime: s.mime,
    size_bytes: s.size_bytes,
    received_week: s.received_week,
    created_at: s.created_at,
    status: filed ? "filed" : s.status === "returned" ? "returned" : "sent",
    ai_read: aiRead(s.ai_read),
    sub_stated_number: s.sub_stated_number,
    sub_stated_amount: stated == null ? null : roundCents(stated),
    returned_reason: s.returned_reason,
    returned_at: s.returned_at,
    filed,
  };
}

/**
 * Portal invoices not filed yet, as invoice rows: With Penney, or Sent back
 * with the reason. The amount is what he typed, else what we read off the
 * file (0.00 when neither is known). A filed one shows as its bill instead.
 */
function submissionGroups(summaries: SubBillSubmissionSummary[]): SubInvoiceGroup[] {
  return summaries
    .filter((s) => s.status !== "filed")
    .map((s) => {
      const amount = roundCents(s.sub_stated_amount ?? s.ai_read?.amount ?? 0);
      return {
        key: `submission:${s.id}`,
        invoice_number: s.sub_stated_number?.trim() || s.ai_read?.invoice_number || null,
        date: etDate(s.created_at),
        amount,
        paid: 0,
        open: amount,
        status: s.status === "returned" ? ("sent_back" as const) : ("with_penney" as const),
        paid_date: null,
        returned_reason: s.status === "returned" ? s.returned_reason : null,
        source: "submission" as const,
        allocations: [],
      };
    });
}

const newestFirst = (a: SubInvoiceGroup, b: SubInvoiceGroup) =>
  (b.date ?? "").localeCompare(a.date ?? "") || a.key.localeCompare(b.key);

/** The agreement fields the agreed amount reads: his rows (home) or W9's summaries (job). */
type AgreedAgreement = Pick<
  SubAgreementRow,
  "id" | "number" | "kind" | "status" | "project_id" | "price_basis" | "price" | "not_to_exceed" | "sub_signed_at"
>;

interface AgreedInput {
  /** agreement_number: project_subcontractors.agreement_id → sub_agreements.number, when read with the link. */
  projectSubs: (ProjectSubRow & { agreement_number?: string | null })[];
  agreements: AgreedAgreement[];
  awards: SubAwardRow[];
}

const isWorkAgreement = (a: AgreedAgreement) => a.kind === "work_order" || a.kind === "change_order";
const agreementValue = (a: AgreedAgreement) =>
  a.price_basis === "time_and_material" ? (num(a.not_to_exceed) ?? 0) : (num(a.price) ?? 0);

/**
 * What he and Penney agreed on one job (plan §2.3 Job info), first that applies:
 * a signed work order (the locked contract amount) > the contract amount
 * on file > Σ his awarded estimate lines > Σ his accepted quotes and bids.
 */
function agreedFor(projectId: string, input: AgreedInput): SubAgreedAmount {
  const ps = input.projectSubs.find((r) => r.project_id === projectId) ?? null;
  const signed = input.agreements.filter((a) => a.project_id === projectId && isWorkAgreement(a) && a.status === "signed");
  const tm = signed.some((a) => a.price_basis === "time_and_material");
  if (ps?.contract_locked_at && ps.agreement_id) {
    const number =
      ps.agreement_number ?? input.agreements.find((a) => a.id === ps.agreement_id)?.number ?? signed[0]?.number ?? null;
    return { amount: cents(ps.contract_amount), basis: "work_order", agreement_number: number, is_not_to_exceed: tm };
  }
  if (signed.length) {
    const newest = [...signed].sort((a, b) => (b.sub_signed_at ?? "").localeCompare(a.sub_signed_at ?? ""))[0];
    return {
      amount: roundCents(signed.reduce((s, a) => s + agreementValue(a), 0)),
      basis: "work_order",
      agreement_number: newest.number,
      is_not_to_exceed: tm,
    };
  }
  if (ps && ps.status !== "removed" && cents(ps.contract_amount) > 0) {
    return { amount: cents(ps.contract_amount), basis: "contract", agreement_number: null, is_not_to_exceed: false };
  }
  const lines = input.awards.filter((a) => a.project_id === projectId && a.source === "line" && a.amount != null);
  const linesTotal = roundCents(lines.reduce((s, a) => s + (a.amount ?? 0), 0));
  if (linesTotal > 0) return { amount: linesTotal, basis: "awarded_lines", agreement_number: null, is_not_to_exceed: false };
  const quoted = input.awards.filter((a) => a.project_id === projectId && a.source !== "line" && a.amount != null);
  const quotedTotal = roundCents(quoted.reduce((s, a) => s + (a.amount ?? 0), 0));
  if (quotedTotal > 0) return { amount: quotedTotal, basis: "quoted", agreement_number: null, is_not_to_exceed: false };
  return { amount: null, basis: "none", agreement_number: null, is_not_to_exceed: false };
}

function moneyByJob(projectId: string, projectName: string, bills: SubBillRow[], agreed: SubAgreedAmount): SubMoneyByJob {
  const rows = bills.filter((b) => b.project_id === projectId);
  const m = rows.map(billMoney);
  return {
    project_id: projectId,
    project_name: projectName,
    agreed,
    billed: roundCents(m.reduce((s, x) => s + x.amount, 0)),
    paid: roundCents(m.reduce((s, x) => s + x.paid, 0)),
    // Same rule as "Owed to you": a bill still needs_review is "With Penney", not open money.
    open: roundCents(rows.reduce((s, b) => (countsTowardOwed(b.review_status) ? s + billMoney(b).open : s), 0)),
  };
}

// ───────────────────────────────────────── preview banner

interface PreviewAccess {
  id: string | null;
  enabled: boolean;
  pinSet: boolean;
  linkSentAt: string | null;
  inviteChannel: SubInviteChannel | null;
  lastViewedAt: string | null;
  viewCount: number;
}

const INVITE_CHANNELS: readonly string[] = ["text", "email", "copy", "qr"];
const INVITE_WORD: Record<SubInviteChannel, string> = { text: "by text", email: "by email", copy: "link copied", qr: "by QR" };

/** His login, read for the staff banner. The PIN hash is never selected: a count says whether one is set. */
async function loadPreviewAccess(supabase: SupabaseClient, subId: string): Promise<PreviewAccess | null> {
  const [row, pin] = await Promise.all([
    supabase
      .from("sub_portal_access")
      .select("id, enabled, link_sent_at, invite_channel, last_viewed_at, view_count")
      .eq("subcontractor_id", subId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sub_portal_access")
      .select("id", { count: "exact", head: true })
      .eq("subcontractor_id", subId)
      .not("pin_hash", "is", null),
  ]);
  const a = row.data;
  if (!a) return null;
  return {
    id: a.id as string,
    enabled: !!a.enabled,
    pinSet: (pin.count ?? 0) > 0,
    linkSentAt: (a.link_sent_at as string | null) ?? null,
    inviteChannel: INVITE_CHANNELS.includes(a.invite_channel ?? "") ? (a.invite_channel as SubInviteChannel) : null,
    lastViewedAt: (a.last_viewed_at as string | null) ?? null,
    viewCount: Number(a.view_count ?? 0),
  };
}

function previewMeta(companyName: string, access: PreviewAccess | null): SubPreviewMeta {
  const parts: string[] = [];
  if (!access) {
    parts.push("No portal login yet");
  } else {
    parts.push(access.enabled ? "Portal on" : "Portal off");
    parts.push(access.pinSet ? "PIN set" : "No PIN yet");
    parts.push(
      access.linkSentAt
        ? `Invited ${fmtShort(access.linkSentAt)}${access.inviteChannel ? ` ${INVITE_WORD[access.inviteChannel]}` : ""}`
        : access.inviteChannel === "qr"
          ? "Signed up from a job QR"
          : "Not invited yet",
    );
    if (!access.lastViewedAt) parts.push("Hasn't opened it");
    else if ((etDate(access.lastViewedAt) ?? "") >= VIEW_FIX_DAY) parts.push(`Last real visit ${fmtShort(access.lastViewedAt)}`);
    else parts.push(`Last opened ${fmtShort(access.lastViewedAt)} (may be an office preview)`);
  }
  parts.push("Nothing you tap here is saved.");
  return {
    sub_name: companyName,
    has_access: !!access,
    portal_on: !!access?.enabled,
    pin_set: !!access?.pinSet,
    invited_at: access?.linkSentAt ?? null,
    invite_channel: access?.inviteChannel ?? null,
    last_real_visit_at: access?.lastViewedAt ?? null,
    view_count: access?.viewCount ?? 0,
    detail: parts.join(" · "),
  };
}

// ───────────────────────────────────────── home

export interface LoadSubHomeOptions {
  subId: string;
  /** The signed-in access row (null in a preview; the preview reads it itself). */
  accessId: string | null;
  mode: SubPortalMode;
  /** Service-role client to reuse; one is made when omitted. */
  supabase?: SupabaseClient;
  /** For tests: the moment "today" and "after 3 PM" are judged at. */
  now?: Date;
}

/**
 * GET /api/sub-portal (and preview-data): Today, Dates, Money and Needed for
 * one sub. null when the sub doesn't exist.
 */
export async function loadSubHome(opts: LoadSubHomeOptions): Promise<SubHomePayload | null> {
  const supabase = opts.supabase ?? createAdminClient();
  const now = opts.now ?? new Date();
  const today = todayET(now);
  const preview = opts.mode === "preview";
  const subId = opts.subId;
  if (!UUID_RE.test(subId)) return null;

  const [subRes, active, clock, loomUrl, access] = await Promise.all([
    supabase.from("subcontractors").select("id, company_name, contact_name, trades").eq("id", subId).maybeSingle(),
    getSubActiveJobs(supabase, subId, { today }),
    loadOpenShift(supabase, subId),
    loadLoomUrl(supabase),
    preview ? loadPreviewAccess(supabase, subId) : Promise.resolve(null),
  ]);
  const sub = subRes.data as { id: string; company_name: string; contact_name: string | null; trades: unknown } | null;
  if (!sub) return null;

  const trades = normalizeTrades(sub.trades);
  const identity: SubIdentity = {
    sub_id: sub.id,
    access_id: preview ? (access?.id ?? null) : opts.accessId,
    company_name: sub.company_name,
    contact_name: sub.contact_name ?? null,
    first_name: firstWord(sub.contact_name),
    trades,
    role: "owner",
  };
  const flags: SubPortalFlags = {
    show_money: identity.role === "owner",
    bills_enabled: subBillsEnabled(),
    agreements_enabled: subAgreementsEnabled(),
    loom_url: loomUrl,
    office_phone: OFFICE_PHONE,
  };

  const { signals, projects } = active;
  const projectName = (id: string | null) => (id ? (projects.get(id)?.name ?? "Job") : null);

  // The third read: trade inspection dates, the filed-bill check and his
  // agreements (W9's summaries, so Needed offers exactly what the sign sheet can).
  const [milestones, filedByPath, agreementSummaries] = await Promise.all([
    loadTradeMilestones(supabase, active.ids, trades, subId, today),
    loadFiledBills(supabase, subId, signals.submissions),
    flags.agreements_enabled
      ? listSubAgreementSummaries(supabase, { subId, mode: opts.mode })
      : Promise.resolve([] as SubAgreementSummary[]),
  ]);

  // ── visits today
  const visitsToday = signals.visits
    .filter((v) => v.visit_date === today)
    .map((v) => visitSummary(v, projectName(v.project_id) ?? "Job"))
    .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));

  // ── dates: his phases on live jobs, plus his trade's inspection dates
  const phases = signals.phases
    .filter((p) => isListableProject(projects.get(p.project_id)))
    .map((p) => toDatePhase(p, projectName(p.project_id) ?? "Job", subId, today, true));
  const inspections = milestones.map((p) => toDatePhase(p, projectName(p.project_id) ?? "Job", subId, today, false));
  const datePhases = [...phases, ...inspections].sort(byStartDate);

  // ── jobs
  const awaiting = new Set(
    signals.agreements.filter((a) => isAwaitingSubSignature(a.status) && a.project_id).map((a) => a.project_id as string),
  );
  const jobRows = active.ids.map((id) =>
    buildJobRow({
      project: projects.get(id)!,
      phases: signals.phases.filter((p) => p.project_id === id),
      visits: signals.visits.filter((v) => v.project_id === id),
      logs: signals.logs.filter((l) => l.project_id === id),
      awaitingAgreement: awaiting.has(id),
      subId,
      today,
    }),
  );

  // ── money
  const submissionSummaries = signals.submissions.map((s) => submissionSummary(s, filedByPath, projectName));
  const bills = mergeFiled(signals.bills, filedByPath);
  const agreedInput: AgreedInput = { projectSubs: signals.projectSubs, agreements: signals.agreements, awards: signals.awards };
  let money: SubMoneyPayload | null = null;
  if (flags.show_money) {
    const invoices = [...groupBills(bills, projectName), ...submissionGroups(submissionSummaries)].sort(newestFirst);
    const year = String(etParts(now).year);
    const paidThisYear = bills.reduce((s, b) => {
      const day = b.paid_date || (b.payment_status === "paid" ? b.invoice_date : null);
      return day && day.startsWith(`${year}-`) ? s + billMoney(b).paid : s;
    }, 0);
    const owed = bills.reduce((s, b) => (countsTowardOwed(b.review_status) ? s + billMoney(b).open : s), 0);
    const agreedByJob = new Map(active.ids.map((id) => [id, agreedFor(id, agreedInput)]));

    // By job: his live jobs, plus any other job where he's still owed.
    const jobIds = new Set(active.ids);
    for (const b of bills) {
      if (b.project_id && countsTowardOwed(b.review_status) && billMoney(b).open > 0 && projects.has(b.project_id)) {
        jobIds.add(b.project_id);
      }
    }
    const byJob = Array.from(jobIds)
      .filter((id) => {
        const p = projects.get(id);
        return !!p && !isInternalJob(p);
      })
      .map((id) => moneyByJob(id, projectName(id) ?? "Job", bills, agreedByJob.get(id) ?? agreedFor(id, agreedInput)))
      .sort((a, b) => b.open - a.open || b.billed - a.billed || a.project_name.localeCompare(b.project_name));

    money = {
      summary: {
        agreed_open_jobs: roundCents(
          active.ids.reduce((s, id) => s + (agreedByJob.get(id)?.amount ?? 0), 0),
        ),
        paid_this_year: roundCents(paidThisYear),
        owed: roundCents(owed),
        waiting_count: invoices.filter((g) => g.status === "with_penney").length,
      },
      invoices,
      by_job: byJob,
      submissions: submissionSummaries,
    };
  }

  // ── needed from you, in the plan's order
  const needed: SubNeededItem[] = [];
  for (const p of datePhases.filter((d) => d.needs_answer)) {
    needed.push({
      kind: "answer_dates",
      key: `answer_dates:${p.id}`,
      title: `Confirm your dates · ${p.project_name}`,
      detail: `${p.name} · ${fmtRange(p.start_date, p.end_date)}`,
      action_label: "Answer",
      project_id: p.project_id,
      project_name: p.project_name,
      phase_id: p.id,
      start_date: p.start_date,
      end_date: p.end_date,
    });
  }
  if (flags.agreements_enabled) needed.push(...signAgreementNeededItems(agreementSummaries));
  if (flags.bills_enabled) {
    for (const s of submissionSummaries.filter((x) => x.status === "returned")) {
      needed.push({
        kind: "bill_returned",
        key: `bill_returned:${s.id}`,
        title: `Invoice sent back${s.project_name ? ` · ${s.project_name}` : ""}`,
        detail: s.returned_reason ? `Reason: ${s.returned_reason}` : null,
        action_label: "Fix & resend",
        project_id: s.project_id,
        project_name: s.project_name,
        submission_id: s.id,
        reason: s.returned_reason,
      });
    }
  }
  if (isAfterET(ADD_PHOTOS_AFTER_HOUR, 0, now)) {
    for (const v of visitsToday) {
      const postedThere = signals.logs.some(
        (l) => l.project_id === v.project_id && etDate(l.started_at) === today && (l.kind !== "shift" || (l.photo_storage_paths?.length ?? 0) > 0),
      );
      if (v.posts > 0 || v.photos > 0 || postedThere) continue;
      needed.push({
        kind: "add_photos",
        key: `add_photos:${v.id}`,
        title: `Add today's ${v.project_name} photos`,
        detail: `You checked in at ${fmtTime(v.first_seen_at)}`,
        action_label: "Add photos",
        project_id: v.project_id,
        project_name: v.project_name,
        visit_id: v.id,
      });
    }
  }

  return {
    mode: opts.mode,
    generated_at: now.toISOString(),
    today,
    sub: identity,
    flags,
    // His latest SCANNED job today (visitsToday is newest last_seen_at first).
    // visits_today stays whole: the add_photos row and the Today bucket use every visit.
    here_now: visitsToday.find((v) => v.scans > 0) ?? null,
    visits_today: visitsToday,
    clock,
    needed,
    jobs: groupJobs(jobRows),
    dates: {
      phases: datePhases,
      answers_needed: datePhases.filter((p) => p.needs_answer).length,
      can_propose_on: active.ids.map((id) => ({ project_id: id, name: projectName(id) ?? "Job" })),
    },
    money,
    preview: preview ? previewMeta(sub.company_name, access) : null,
  };
}

// ───────────────────────────────────────── job

export interface LoadSubJobOptions {
  subId: string;
  projectId: string;
  mode: SubPortalMode;
  /** The opaque next_cursor from the previous page; null/empty for the first. */
  cursor?: string | null;
  supabase?: SupabaseClient;
  now?: Date;
}

export type SubJobResult = { ok: true; data: SubJobPayload } | { ok: false; status: 400 | 404; error: string };

const CURSOR_TS = /^\d{4}-\d{2}-\d{2}[T ][0-9:.]+(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;

function encodeCursor(startedAt: string, id: string): string {
  return Buffer.from(`${startedAt}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { ts: string; id: string } | null {
  try {
    const [ts, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!ts || !id || !CURSOR_TS.test(ts) || !UUID_RE.test(id)) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

// A post always shows (its photos may still be uploading); a shift only when
// it carries words or photos. A bare clock-out is a time record, not a post.
const POST_CONTENT = "kind.eq.post,kind.is.null,text.not.is.null,photo_storage_paths.not.is.null";

type PostRow = {
  id: string;
  project_id: string;
  kind: string | null;
  status: string | null;
  text: string | null;
  photo_storage_paths: string[] | null;
  started_at: string;
  client_hidden_at: string | null;
};

type FileRow = {
  id: string;
  project_id: string;
  filename: string | null;
  category: string | null;
  mime_type: string | null;
  size: number | null;
  storage_path: string | null;
  storage_bucket: string | null;
  created_at: string | null;
};

const FILE_GROUPS: { key: SubFileGroup; label: string }[] = [
  { key: "drawings", label: "Drawings" },
  { key: "specs", label: "Specs" },
  { key: "permits", label: "Permits" },
  { key: "design", label: "Design & selections" },
];

function fileGroup(category: string | null, name: string): SubFileGroup {
  if (category === "permits") return "permits";
  if (DESIGN_NAME.test(name)) return "design";
  return category === "specs" ? "specs" : "drawings";
}

/**
 * GET /api/sub-portal/job/[id] (and the preview's job fetch): one job as he
 * sees it. 404 when it isn't one of his (active, or a job he billed).
 */
export async function loadSubJob(opts: LoadSubJobOptions): Promise<SubJobResult> {
  const supabase = opts.supabase ?? createAdminClient();
  const now = opts.now ?? new Date();
  const today = todayET(now);
  const { subId, projectId } = opts;
  const notFound = { ok: false as const, status: 404 as const, error: "That job isn't on your list." };
  if (!UUID_RE.test(subId) || !UUID_RE.test(projectId)) return notFound;

  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  if (opts.cursor && !cursor) return { ok: false, status: 400, error: "Couldn't load more posts. Pull down to refresh." };

  const [jobAccess, assigned, projectRes, subRes] = await Promise.all([
    canSubViewJob(supabase, subId, projectId, { today }),
    // Put on the job by the office (not just a QR visit): only then can he mark inspections.
    isSubOnJob(supabase, subId, projectId, { today, assignedOnly: true }),
    supabase.from("projects").select(SUB_JOB_PROJECT_COLUMNS).eq("id", projectId).maybeSingle(),
    supabase.from("subcontractors").select("id, company_name, contact_name, trades").eq("id", subId).maybeSingle(),
  ]);
  const project = projectRes.data as SubJobProject | null;
  const sub = subRes.data as { id: string; company_name: string; contact_name: string | null; trades: unknown } | null;
  if (!jobAccess.view || !project || !sub) return notFound;

  const trades = normalizeTrades(sub.trades);
  const showMoney = true; // R1: every login is the company owner.
  const agreementsEnabled = subAgreementsEnabled();

  let postsQuery = supabase
    .from("daily_logs")
    .select("id, project_id, kind, status, text, photo_storage_paths, started_at, client_hidden_at")
    .eq("project_id", projectId)
    .eq("subcontractor_id", subId)
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(POSTS_PAGE + 1);
  postsQuery = cursor
    ? postsQuery.or(
        `and(started_at.lt."${cursor.ts}",or(${POST_CONTENT})),and(started_at.eq."${cursor.ts}",id.lt.${cursor.id},or(${POST_CONTENT}))`,
      )
    : postsQuery.or(POST_CONTENT);

  const [
    phasesRes, visitRes, postsRes, filesRes, dismissedRes, overridesRes, scopeRes, inspectionsRes,
    selectionsRes, quotesRes, bidsRes, billsRes, submissionsRes, agreementSummaries, projectSubRes, linesRes,
    pmRes, clock,
  ] = await Promise.all([
    supabase
      .from("schedule_phases")
      .select(SUB_PHASE_COLUMNS)
      .eq("project_id", projectId)
      .contains("assigned_sub_ids", [subId])
      .order("start_date", { ascending: true, nullsFirst: false })
      .limit(200),
    supabase
      .from("sub_site_visits")
      .select("id, project_id, visit_date, first_seen_at, last_seen_at, first_source, scans, posts, photos")
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId)
      .eq("visit_date", today)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    postsQuery,
    supabase
      .from("project_files")
      .select("id, project_id, filename, category, mime_type, size, storage_path, storage_bucket, created_at")
      .eq("project_id", projectId)
      .in("category", SUB_FILE_CATEGORIES)
      .order("created_at", { ascending: false }),
    supabase.from("project_dismissed_files").select("file_key").eq("project_id", projectId),
    supabase.from("project_file_overrides").select("file_key, category, display_name").eq("project_id", projectId),
    // His trades on the job's current estimate: scope text only; the function returns no prices.
    supabase.rpc("sub_portal_trade_scope", { p_sub_id: subId, p_project_ids: [projectId] }),
    supabase
      .from("project_inspections")
      .select("id, name, status, scheduled_for, completed_at, is_final, sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true }),
    // No allowance amounts, ever.
    supabase
      .from("client_selections")
      .select("id, category, description, status, selected_value")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("quote_requests")
      .select("id, trade, scope_description, amount, status, attachment_storage_path, sent_at, received_at, created_at")
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId),
    supabase
      .from("subcontractor_bids")
      .select("id, amount, status, attachment_storage_path, submitted_at, created_at, bid_packages!inner(project_id, name, trade, scope_of_work)")
      .eq("subcontractor_id", subId)
      .eq("bid_packages.project_id", projectId),
    showMoney
      ? supabase.from("invoices").select(SUB_BILL_COLUMNS).eq("project_id", projectId).eq("subcontractor_id", subId).limit(500)
      : Promise.resolve({ data: [] as SubBillRow[] }),
    supabase
      .from("sub_bill_submissions")
      .select(SUB_SUBMISSION_COLUMNS)
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId)
      .order("created_at", { ascending: false })
      .limit(100),
    // W9's summaries: can_sign (never in preview), master-first and pdf_url
    // are decided in one place, the same as the sign sheet and Needed.
    agreementsEnabled
      ? listSubAgreementSummaries(supabase, { subId, projectId, mode: opts.mode })
      : Promise.resolve([] as SubAgreementSummary[]),
    supabase
      .from("project_subcontractors")
      .select("project_id, contract_amount, status, agreement_id, contract_locked_at, agreement:sub_agreements!agreement_id(number)")
      .eq("project_id", projectId)
      .eq("subcontractor_id", subId),
    supabase
      .from("estimate_line_items")
      .select("id, awarded_cost, estimates!inner(project_id, is_option)")
      .eq("awarded_subcontractor_id", subId)
      .eq("estimates.project_id", projectId),
    project.assigned_pm
      ? supabase.from("profiles").select("full_name, phone").eq("id", project.assigned_pm).maybeSingle()
      : Promise.resolve({ data: null }),
    loadOpenShift(supabase, subId),
  ]);

  // ── posts (his company's only), photos signed for this page alone
  const fetched = (postsRes.data ?? []) as PostRow[];
  const pageRows = fetched.slice(0, POSTS_PAGE);
  const nextCursor = fetched.length > POSTS_PAGE ? encodeCursor(pageRows[pageRows.length - 1].started_at, pageRows[pageRows.length - 1].id) : null;
  const shown = pageRows.filter((r) => isPostLike(r));
  const photoPaths = shown.flatMap((r) => r.photo_storage_paths ?? []);

  // ── files: the crew Job Folder filter, then the sub categories
  const files = fieldVisibleFiles(
    (filesRes.data ?? []) as FileRow[],
    ((dismissedRes.data ?? []) as { file_key: string }[]).map((d) => d.file_key),
    (overridesRes.data ?? []) as { file_key: string; category: string | null; display_name: string | null }[],
  ).filter((f) => !!f.storage_path && SUB_FILE_CATEGORIES.includes(f.category ?? ""));

  // ── quotes and bids (his own prices)
  type BidRow = {
    id: string;
    amount: number | string | null;
    status: string | null;
    attachment_storage_path: string | null;
    submitted_at: string | null;
    created_at: string;
    bid_packages: unknown;
  };
  type QuoteRow = {
    id: string;
    trade: string | null;
    scope_description: string | null;
    amount: number | string | null;
    status: string | null;
    attachment_storage_path: string | null;
    sent_at: string | null;
    received_at: string | null;
    created_at: string;
  };
  const quoteRows = (quotesRes.data ?? []) as QuoteRow[];
  const bidRows = (bidsRes.data ?? []) as BidRow[];

  // ── billing
  const jobSubmissions = (submissionsRes.data ?? []) as SubSubmissionRow[];
  // Work orders and SCOs on this job (the MSA has no job; it lives in Papers).
  const jobAgreements = agreementSummaries.filter((a) => a.kind !== "master");

  const [signedFiles, thumbs, signedPhotos, filedByPath] = await Promise.all([
    signAll(
      supabase,
      [
        ...files.map((f) => ({ bucket: f.storage_bucket ?? "project-files", path: f.storage_path })),
        ...quoteRows.map((q) => ({ bucket: QUOTE_BUCKET, path: q.attachment_storage_path })),
        ...bidRows.map((b) => ({ bucket: QUOTE_BUCKET, path: b.attachment_storage_path })),
      ],
    ),
    photoPaths.length ? signThumbUrls(supabase, PHOTO_BUCKET, photoPaths, SIGN_TTL, THUMB_BOX) : Promise.resolve(new Map<string, string>()),
    photoPaths.length
      ? cachedSignedUrls(supabase, PHOTO_BUCKET, photoPaths, SIGN_TTL)
      : Promise.resolve({ data: [] as { path: string; signedUrl: string }[] }),
    showMoney ? loadFiledBills(supabase, subId, jobSubmissions) : Promise.resolve(new Map<string, SubBillRow[]>()),
  ]);

  const fullByPath = new Map(signedPhotos.data.map((s) => [s.path, s.signedUrl]));
  const posts: SubPost[] = shown.map((r) => {
    const day = etDate(r.started_at) ?? today;
    const paths = r.photo_storage_paths ?? [];
    const photos: SubPhoto[] = paths.flatMap((p) => {
      const full = fullByPath.get(p);
      return full ? [{ thumb: thumbs.get(p) ?? full, full, date: day }] : [];
    });
    return {
      id: r.id,
      project_id: r.project_id,
      posted_at: r.started_at,
      day,
      kind: r.kind === "shift" ? "shift" : "post",
      text: r.text?.trim() || null,
      author_label: sub.company_name,
      photos,
      photo_count: paths.length,
      client_hidden: !!r.client_hidden_at,
    };
  });
  const postsPage: SubPostsPage = { items: posts, next_cursor: nextCursor };

  // Documents, newest first inside each group; empty groups left out.
  const docs: SubDocument[] = files.flatMap((f) => {
    const bucket = f.storage_bucket ?? "project-files";
    const url = signedFiles.get(`${bucket}/${f.storage_path}`);
    if (!url) return [];
    const title = f.filename ?? "Document";
    const rev = drawingRevision(title);
    return [
      {
        id: f.id,
        title,
        subtitle: rev ? `Rev ${rev.revision}` : null,
        date: f.created_at ? etDate(f.created_at) : null,
        url,
        mime: f.mime_type,
        group: fileGroup(f.category, title),
      },
    ];
  });
  const fileGroups: SubDocumentGroup[] = FILE_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    docs: docs
      .filter((d) => d.group === g.key)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.title.localeCompare(b.title)),
  })).filter((g) => g.docs.length > 0);

  const scope: SubScopeLine[] = ((scopeRes.data ?? []) as { project_id: string; trade: string | null; description: string | null; scope: string | null }[])
    .filter((r) => r.project_id === projectId && (r.description || r.scope))
    .map((r) => ({ trade: r.trade ?? "", description: r.description ?? "", scope: r.scope ?? null }));

  const inspections: SubInspection[] = (
    (inspectionsRes.data ?? []) as {
      id: string;
      name: string;
      status: string | null;
      scheduled_for: string | null;
      completed_at: string | null;
      is_final: boolean | null;
    }[]
  ).map((i) => ({
    id: i.id,
    name: i.name,
    status: i.status === "passed" || i.status === "failed" ? i.status : "pending",
    scheduled_for: i.scheduled_for,
    completed_at: i.completed_at,
    is_final: !!i.is_final,
    // The inspections route refuses by the same rule: his trade, on a job
    // the office put him on (a QR-only sign-up sees them read-only).
    my_trade: assigned && subDoesInspection(trades, i.name),
  }));

  const selections: SubSelection[] = (
    (selectionsRes.data ?? []) as { id: string; category: string | null; description: string | null; status: string | null; selected_value: string | null }[]
  ).map((s) => ({
    id: s.id,
    category: s.category ?? "",
    description: s.description,
    status: s.status ?? "pending",
    selected_value: s.selected_value,
  }));

  // ── his dates on this job (read-only here)
  const phaseRows = (phasesRes.data ?? []) as SubPhaseRow[];
  const dates = phaseRows.map((p) => toDatePhase(p, project.name, subId, today, true)).sort(byStartDate);

  // ── agreed
  const awards: SubAwardRow[] = [
    ...quoteRows
      .filter((q) => isAwardedQuoteStatus(q.status))
      .map((q) => ({ source: "quote" as const, id: q.id, project_id: projectId, amount: num(q.amount) })),
    ...bidRows
      .filter((b) => b.status === "accepted")
      .map((b) => ({ source: "bid" as const, id: b.id, project_id: projectId, amount: num(b.amount) })),
    ...((linesRes.data ?? []) as { id: string; awarded_cost: number | string | null; estimates: unknown }[])
      .filter((l) => !one(l.estimates as { is_option: boolean | null } | { is_option: boolean | null }[])?.is_option)
      .map((l) => ({ source: "line" as const, id: l.id, project_id: projectId, amount: num(l.awarded_cost) })),
  ];
  const projectSubs = ((projectSubRes.data ?? []) as unknown as (ProjectSubRow & { agreement: unknown })[]).map(
    ({ agreement, ...row }) => ({
      ...row,
      agreement_number: one(agreement as { number: string | null } | { number: string | null }[] | null)?.number ?? null,
    }),
  );
  const agreed = agreedFor(projectId, { projectSubs, agreements: jobAgreements, awards });

  // ── quotes: awarded first, then newest
  const quotes: SubQuote[] = [
    ...quoteRows.map((q) => ({
      id: q.id,
      source: "quote" as const,
      title: q.trade ? q.trade.charAt(0).toUpperCase() + q.trade.slice(1) : "Quote",
      trade: q.trade,
      scope: q.scope_description,
      amount: num(q.amount) == null ? null : cents(q.amount),
      status: q.status ?? "",
      stage: subQuoteStage(q.status),
      date: q.received_at ?? q.sent_at ?? q.created_at ?? null,
      pdf_url: q.attachment_storage_path ? (signedFiles.get(`${QUOTE_BUCKET}/${q.attachment_storage_path}`) ?? null) : null,
    })),
    ...bidRows.map((b) => {
      const pkg = one(b.bid_packages as { name: string | null; trade: string | null; scope_of_work: string | null } | { name: string | null; trade: string | null; scope_of_work: string | null }[]);
      return {
        id: b.id,
        source: "bid" as const,
        title: pkg?.name || pkg?.trade || "Bid",
        trade: pkg?.trade ?? null,
        scope: pkg?.scope_of_work ?? null,
        amount: num(b.amount) == null ? null : cents(b.amount),
        status: b.status ?? "",
        stage: subQuoteStage(b.status),
        date: b.submitted_at ?? b.created_at ?? null,
        pdf_url: b.attachment_storage_path ? (signedFiles.get(`${QUOTE_BUCKET}/${b.attachment_storage_path}`) ?? null) : null,
      };
    }),
  ].sort(
    (a, b) => Number(b.stage === "awarded") - Number(a.stage === "awarded") || (b.date ?? "").localeCompare(a.date ?? ""),
  );

  // ── billing on this job
  let billing: SubJobPayload["billing"] = null;
  if (showMoney) {
    const name = (id: string | null) => (id === projectId ? project.name : null);
    const jobBills = mergeFiled((billsRes.data ?? []) as SubBillRow[], filedByPath).filter((b) => b.project_id === projectId);
    const summaries = jobSubmissions.map((s) => submissionSummary(s, filedByPath, name));
    billing = {
      summary: moneyByJob(projectId, project.name, jobBills, agreed),
      invoices: [...groupBills(jobBills, name), ...submissionGroups(summaries)].sort(newestFirst),
    };
  }

  // ── composer: his phase covering today; its trade chip is pre-picked
  const covering = phaseRows.filter((p) => !isParkedPlanStep(p) && coversDay(p.start_date, p.end_date, today));
  let todayPhase: SubComposerContext["today_phase"] = null;
  if (covering.length) {
    const tradesOf = covering.map((p) => tradeForPhaseName(p.name));
    const sameTrade = tradesOf.every((t) => t === tradesOf[0]);
    if (covering.length === 1 || sameTrade) {
      todayPhase = { id: covering[0].id, name: covering[0].name, trade: tradesOf[0] ? tradesOf[0].toLowerCase() : null };
    }
  }

  const address = oneLineAddress(project);
  const pmRow = pmRes.data as { full_name: string | null; phone: string | null } | null;
  const pm: SubJobContact | null = pmRow
    ? { name: pmRow.full_name ?? null, first_name: firstWord(pmRow.full_name), phone: pmRow.phone?.trim() || null }
    : null;
  const visit = visitRes.data as SubVisitRow | null;

  return {
    ok: true,
    data: {
      mode: opts.mode,
      generated_at: now.toISOString(),
      today,
      job: {
        project_id: project.id,
        name: project.name,
        project_number: project.project_number ?? "",
        address,
        town: project.city ?? null,
        status: project.status,
        directions_url: directionsUrl(address),
        pm,
        // Only his own QR scan today says he's here; a post or clock-in makes a
        // visit row too (scans 0), and must not show "✓ Checked in".
        visit_today: visit && (visit.scans ?? 0) > 0 ? visitSummary(visit, project.name) : null,
      },
      can_post: jobAccess.post,
      posts: postsPage,
      files: fileGroups,
      scope,
      inspections,
      selections,
      dates,
      agreed,
      quotes,
      billing,
      agreements: jobAgreements,
      composer: { trades, today_phase: todayPhase },
      clock,
    },
  };
}
