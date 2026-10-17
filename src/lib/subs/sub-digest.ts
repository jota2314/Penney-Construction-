import "server-only";
import { isInternalJob } from "@/lib/crew/crew-visibility";
import { isMaterialSupplier, SERVICE_KEYWORDS } from "@/lib/finance/spend-category";
import { formatMoney } from "@/lib/money";
import {
  notifySubDigest,
  resolveSubNoticeRecipients,
  subDisplayName,
  type SubNoticeResult,
} from "@/lib/notifications/sub-field-notify";
import { isParkedPlanStep } from "@/lib/schedule/parked";
import { NOBODY_DAYS, nobodyPhases } from "@/lib/schedule/subs-needed-rule";
import {
  addDays,
  coversDay,
  etDayRange,
  etMonday,
  etStartOfDay,
  etTimeLabel,
  isAfterET,
  todayET,
  weekdayOf,
} from "@/lib/sub-portal/et-day";
import { isSubLiveStatus } from "@/lib/sub-portal/statuses";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

/**
 * Where the subs were today, for the office (plan §4.1 and §4.3).
 *
 * Two readers share one load so they can never disagree:
 *  - the Job Board "Subs today" strip (getSubsToday in actions/sub-activity.ts)
 *  - the 5:30 PM digest (the sub-field-digest cron), which adds the weekly
 *    "Billed, no field record" check, the unassigned-phase count and the
 *    sub bills still waiting to be filed.
 *
 * "On site" is any of: a QR check-in (sub_site_visits), a sub post today, or
 * an open sub shift. "Scheduled" is a CONFIRMED phase covering today with
 * the sub in assigned_sub_ids; a penciled-in phase only counts toward "on
 * the schedule" for a sub who showed up. Everything is the Massachusetts day
 * (et-day.ts).
 *
 * Sub daily_logs carry no author_id (subcontractor_id instead), and every
 * id list below drops nulls before it reaches an `.in()`: an `in.(null)`
 * took /projects down for a day (3058dad).
 *
 * Read-only apart from the digest's own notice rows, written through the
 * W0 writer (one row per recipient per day, pushed on insert, never email).
 */

type Admin = ReturnType<typeof createAdminClient>;

/** The links in texts and notices go to the www host: the portal cookie is host-only. */
const PORTAL_URL = "https://www.penneyconstruction.build/sub/portal";

/** After this ET hour, a sub on site with no post gets "On site, no post yet". */
const NO_POST_NUDGE_HOUR = 15;

/** Phases that don't put a sub on site. Inspections and meetings still count toward "on the schedule". */
const NOT_PRESENCE_EVENTS = new Set(["meeting", "shop_meeting", "walkthrough", "inspection"]);

/** Jobs being built or about to be: where a missing check-in matters. */
const STAFFED_STATUSES = new Set(["in_progress", "contracted"]);

/** app_notifications.body is capped at 500 characters by the table. */
const BODY_MAX = 500;

// ─────────────────────────────── Shapes

export type SubTodayState = "on_site" | "scheduled_no_checkin";

/** One sub at one job today. */
export interface SubTodayRow {
  /** `${subId}:${projectId}` */
  key: string;
  subId: string;
  projectId: string;
  projectName: string;
  /** "Weidlein Bathroom — 7 Hamilton St" → "Weidlein Bathroom". */
  jobShort: string;
  pmId: string | null;
  company: string;
  /** "MGL Tile Inc (Marcio)" */
  label: string;
  state: SubTodayState;
  /** An assigned phase covers today on this job (any kind, any status). */
  onSchedule: boolean;
  /** The first of today's assigned phases on this job, for "scheduled at Weidlein · Cabinets". */
  phaseName: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  posts: number;
  photos: number;
  /** He scanned the sign today. */
  scanned: boolean;
  /** An open sub shift on this job. */
  clockedIn: boolean;
  /** On site, nothing posted, and it's past 3 PM ET. */
  noPostYet: boolean;
  /** sms: link with the "add today's photos" text, or null when he has no usable phone. */
  smsHref: string | null;
}

export interface SubsToday {
  day: string;
  generatedAt: string;
  afterThree: boolean;
  /** On site first (earliest first), then scheduled with no check-in. */
  rows: SubTodayRow[];
  counts: { onSite: number; noCheckin: number; noPostYet: number; unscheduled: number };
}

interface VisitRow {
  project_id: string;
  subcontractor_id: string;
  first_seen_at: string;
  last_seen_at: string;
  scans: number;
  posts: number;
  photos: number;
}

interface SubLogRow {
  id: string;
  project_id: string | null;
  subcontractor_id: string | null;
  kind: string | null;
  status: string | null;
  text: string | null;
  photo_storage_paths: string[] | null;
  started_at: string;
  ended_at: string | null;
}

interface PhaseRow {
  id: string;
  project_id: string | null;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  event_type: string | null;
  phase_scope: string | null;
  is_confirmed: boolean | null;
  planned_start_date: string | null;
  is_manually_scheduled: boolean | null;
  estimate_line_item_id: string | null;
  assigned_employee_ids: string[] | null;
  assigned_sub_ids: string[] | null;
}

interface SubRow {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  phone: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  project_number: string | null;
  status: string | null;
  is_overhead: boolean | null;
  assigned_pm: string | null;
}

// ─────────────────────────────── Small helpers

const uniq = <T>(values: (T | null | undefined)[]): T[] =>
  Array.from(new Set(values.filter((v): v is T => v !== null && v !== undefined && v !== "")));

/** `.in()` lists stay short enough for a URL. */
function chunks<T>(list: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The part of a job name people say: before " — ", " - " or "(". */
export function shortJobName(name: string): string {
  const short = name.split(/\s+[—–-]\s+|\s*\(/)[0]?.trim();
  return short || name;
}

/**
 * The PM's own phone sends this (no SMS service): "Marcio, add today's
 * Pedersen photos: https://www.penneyconstruction.build/sub/portal?job=…".
 * `?&body=` is the form both iOS and Android read.
 */
export function subPhotoTextHref(
  phone: string | null | undefined,
  firstName: string,
  jobShort: string,
  projectId: string,
): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  const body = `${firstName}, add today's ${jobShort} photos: ${PORTAL_URL}?job=${projectId}`;
  return `sms:+1${ten}?&body=${encodeURIComponent(body)}`;
}

const earliest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a <= b ? a : b);
const latest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a >= b ? a : b);

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T;
}

async function loadProjects(admin: Admin, ids: string[]): Promise<Map<string, ProjectRow>> {
  const map = new Map<string, ProjectRow>();
  for (const part of chunks(uniq(ids))) {
    const rows = must<ProjectRow[]>(
      await admin
        .from("projects")
        .select("id, name, project_number, status, is_overhead, assigned_pm")
        .in("id", part),
      "projects",
    );
    for (const p of rows) map.set(p.id, p);
  }
  return map;
}

/** A job the office tracks subs on: not cancelled, not Office / Shop / Warehouse. */
const isTrackedJob = (p: ProjectRow | undefined): p is ProjectRow =>
  !!p && p.status !== "cancelled" && !isInternalJob(p);

// ─────────────────────────────── Today

/** Who was (or should have been) on which job today. */
export async function loadSubDay(admin: Admin, { now = new Date() }: { now?: Date } = {}): Promise<SubsToday> {
  const day = todayET(now);
  const { start, end } = etDayRange(day);
  const weekend = weekdayOf(day) === 0 || weekdayOf(day) === 6;
  const afterThree = isAfterET(NO_POST_NUDGE_HOUR, 0, now);
  const logColumns = "id, project_id, subcontractor_id, kind, status, text, photo_storage_paths, started_at, ended_at";

  const [visitsRes, logsRes, openRes, phases] = await Promise.all([
    admin
      .from("sub_site_visits")
      .select("project_id, subcontractor_id, first_seen_at, last_seen_at, scans, posts, photos")
      .eq("visit_date", day),
    admin
      .from("daily_logs")
      .select(logColumns)
      .not("subcontractor_id", "is", null)
      .gte("started_at", start)
      .lt("started_at", end)
      .order("started_at")
      .limit(1000),
    // Open shifts can start before midnight; the 12-hour auto clock-out
    // keeps them recent, and the 16-hour floor covers a missed cron run.
    admin
      .from("daily_logs")
      .select(logColumns)
      .not("subcontractor_id", "is", null)
      .eq("status", "in_progress")
      .gte("started_at", new Date(now.getTime() - 16 * 3_600_000).toISOString())
      .limit(200),
    fetchAllRows<PhaseRow>((from, to) =>
      admin
        .from("schedule_phases")
        .select("id, project_id, name, start_date, end_date, status, event_type, phase_scope, is_confirmed, planned_start_date, is_manually_scheduled, estimate_line_item_id, assigned_employee_ids, assigned_sub_ids")
        .lte("start_date", day)
        .or(`end_date.gte.${day},end_date.is.null`)
        .not("assigned_sub_ids", "is", null)
        .order("start_date")
        .order("id")
        .range(from, to),
    ),
  ]);
  const visits = must<VisitRow[]>(visitsRes, "sub_site_visits");
  const logs = must<SubLogRow[]>(logsRes, "sub posts");
  const openShifts = must<SubLogRow[]>(openRes, "open sub shifts");

  interface Acc {
    subId: string;
    projectId: string;
    visit: VisitRow | null;
    logs: SubLogRow[];
    open: SubLogRow | null;
    /** Every assigned phase covering today. */
    covering: PhaseRow[];
    /** The ones that mean "he should be on site". */
    presence: PhaseRow[];
  }
  const acc = new Map<string, Acc>();
  const slot = (subId: string, projectId: string): Acc => {
    const key = `${subId}:${projectId}`;
    let a = acc.get(key);
    if (!a) {
      a = { subId, projectId, visit: null, logs: [], open: null, covering: [], presence: [] };
      acc.set(key, a);
    }
    return a;
  };

  for (const v of visits) {
    const a = slot(v.subcontractor_id, v.project_id);
    // R1 has one row per sub per job per day (worker_id is null); sum anyway so R2 workers add up.
    a.visit = a.visit
      ? {
          ...a.visit,
          first_seen_at: earliest(a.visit.first_seen_at, v.first_seen_at) as string,
          last_seen_at: latest(a.visit.last_seen_at, v.last_seen_at) as string,
          scans: a.visit.scans + v.scans,
          posts: a.visit.posts + v.posts,
          photos: a.visit.photos + v.photos,
        }
      : v;
  }
  for (const l of logs) {
    if (!l.subcontractor_id || !l.project_id) continue;
    slot(l.subcontractor_id, l.project_id).logs.push(l);
  }
  for (const l of openShifts) {
    if (!l.subcontractor_id || !l.project_id || l.ended_at) continue;
    slot(l.subcontractor_id, l.project_id).open = l;
  }
  for (const ph of phases) {
    if (!ph.project_id || !coversDay(ph.start_date, ph.end_date, day)) continue;
    // A parked "From Estimate" step's placeholder day isn't a scheduled day:
    // not "he should be on site", not "on schedule".
    if (isParkedPlanStep(ph)) continue;
    // Weekends: a two-week master phase doesn't mean he works Saturday.
    // Only a day assignment, or a phase that starts today, does.
    // Penciled in (unconfirmed) = he hasn't been told yet (Subs needed asks
    // "Confirm & notify"), so it never makes "scheduled, no check-in" or a
    // Text nudge. It still lands in `covering` for a sub who showed up.
    const presence =
      !!ph.is_confirmed &&
      !NOT_PRESENCE_EVENTS.has(ph.event_type ?? "") &&
      ph.status !== "completed" &&
      ph.status !== "on_hold" &&
      (!weekend || ph.phase_scope === "daily" || ph.start_date === day);
    for (const subId of uniq(ph.assigned_sub_ids ?? [])) {
      // Only an existing slot or a presence phase opens a row: a covering
      // inspection alone isn't "scheduled, no check-in".
      const key = `${subId}:${ph.project_id}`;
      if (!acc.has(key) && !presence) continue;
      const a = slot(subId, ph.project_id);
      a.covering.push(ph);
      if (presence) a.presence.push(ph);
    }
  }

  const all = Array.from(acc.values());
  const subIds = uniq(all.map((a) => a.subId));
  const [projects, subs] = await Promise.all([
    loadProjects(admin, all.map((a) => a.projectId)),
    (async () => {
      const map = new Map<string, SubRow>();
      for (const part of chunks(subIds)) {
        const rows = must<SubRow[]>(
          await admin.from("subcontractors").select("id, company_name, contact_name, phone").in("id", part),
          "subcontractors",
        );
        for (const s of rows) map.set(s.id, s);
      }
      return map;
    })(),
  ]);

  const rows: SubTodayRow[] = [];
  for (const a of all) {
    const project = projects.get(a.projectId);
    const sub = subs.get(a.subId);
    if (!isTrackedJob(project) || !sub) continue;

    const onSite = !!a.visit || a.logs.length > 0 || !!a.open;
    // "Scheduled, no check-in" only on jobs being built or about to be: a
    // stale phase left on a finished job isn't a no-show.
    if (!onSite && (a.presence.length === 0 || !STAFFED_STATUSES.has(project.status ?? ""))) continue;

    // A post is a post, or a shift that carries words or photos (the clock-out post).
    const photoCount = (l: SubLogRow) => (l.photo_storage_paths ?? []).length;
    const loggedPosts = a.logs.filter((l) => l.kind === "post" || !!l.text?.trim() || photoCount(l) > 0).length;
    const loggedPhotos = a.logs.reduce((n, l) => n + photoCount(l), 0);
    // The visit counters and the rows can each run ahead of the other for a
    // moment (a photo still uploading); the larger is the truer.
    const posts = Math.max(loggedPosts, a.visit?.posts ?? 0);
    const photos = Math.max(loggedPhotos, a.visit?.photos ?? 0);

    let firstSeenAt: string | null = a.visit?.first_seen_at ?? null;
    let lastSeenAt: string | null = a.visit?.last_seen_at ?? null;
    for (const l of [...a.logs, ...(a.open ? [a.open] : [])]) {
      firstSeenAt = earliest(firstSeenAt, l.started_at);
      lastSeenAt = latest(lastSeenAt, l.ended_at ?? l.started_at);
    }

    const company = sub.company_name?.trim() || "A sub";
    const label = subDisplayName({ company_name: company, contact_name: sub.contact_name });
    const firstName = (sub.contact_name ?? "").trim().split(/\s+/)[0] || company;
    const jobShort = shortJobName(project.name);
    const phase = a.presence[0] ?? a.covering[0] ?? null;

    rows.push({
      key: `${a.subId}:${a.projectId}`,
      subId: a.subId,
      projectId: a.projectId,
      projectName: project.name,
      jobShort,
      pmId: project.assigned_pm,
      company,
      label,
      state: onSite ? "on_site" : "scheduled_no_checkin",
      onSchedule: a.covering.length > 0,
      phaseName: phase?.name ?? null,
      firstSeenAt: onSite ? firstSeenAt : null,
      lastSeenAt: onSite ? lastSeenAt : null,
      posts,
      photos,
      scanned: (a.visit?.scans ?? 0) > 0,
      clockedIn: !!a.open,
      noPostYet: onSite && posts === 0 && afterThree,
      smsHref: subPhotoTextHref(sub.phone, firstName, jobShort, a.projectId),
    });
  }

  rows.sort((a, b) => {
    if (a.state !== b.state) return a.state === "on_site" ? -1 : 1;
    if (a.state === "on_site") return (a.firstSeenAt ?? "").localeCompare(b.firstSeenAt ?? "") || a.label.localeCompare(b.label);
    return a.projectName.localeCompare(b.projectName) || a.label.localeCompare(b.label);
  });

  const onSiteRows = rows.filter((r) => r.state === "on_site");
  return {
    day,
    generatedAt: now.toISOString(),
    afterThree,
    rows,
    counts: {
      onSite: onSiteRows.length,
      noCheckin: rows.length - onSiteRows.length,
      noPostYet: onSiteRows.filter((r) => r.noPostYet).length,
      unscheduled: onSiteRows.filter((r) => !r.onSchedule).length,
    },
  };
}

// ─────────────────────────────── The digest

/** A sub bill entered this week on a job where that sub left no visit or post this week. */
export interface BilledNoFieldRecord {
  subId: string;
  company: string;
  projectId: string;
  jobShort: string;
  pmId: string | null;
  invoiceNumbers: string[];
  amount: number;
}

export interface SubBillWaiting {
  id: string;
  projectId: string | null;
  pmId: string | null;
}

export interface UnassignedPhase {
  id: string;
  projectId: string;
  pmId: string | null;
}

export interface SubDigestDeliveryDraft {
  profileId: string;
  name: string;
  /** Jorge sees every job; a PM sees theirs. */
  scope: "all" | "pm";
  title: string;
  body: string;
}

export interface SubDigestBuild {
  day: string;
  generatedAt: string;
  today: SubsToday;
  billedNoFieldRecord: BilledNoFieldRecord[];
  unassignedPhases: UnassignedPhase[];
  billsWaiting: SubBillWaiting[];
  deliveries: SubDigestDeliveryDraft[];
  /** Intended recipients with no push subscription: they only see it in the bell. */
  withoutPush: { profileId: string; name: string }[];
}

/**
 * The T&M check: sub bills entered since Monday (ET) on a job where that
 * sub has no QR visit and no post this week. Material dealers, service
 * vendors (dumpsters, porta-johns, permits) and in-house labor are left out:
 * they never post from a site.
 */
async function loadBilledNoFieldRecord(admin: Admin, now: Date): Promise<Omit<BilledNoFieldRecord, "jobShort" | "pmId">[]> {
  const monday = etMonday(now);
  const weekStart = etStartOfDay(monday).toISOString();

  const [billsRes, visitsRes, logsRes] = await Promise.all([
    admin
      .from("invoices")
      .select("id, project_id, subcontractor_id, vendor_name, vendor_type, invoice_number, amount, created_at")
      .not("subcontractor_id", "is", null)
      .not("project_id", "is", null)
      .gte("created_at", weekStart)
      .order("created_at")
      .limit(1000),
    admin.from("sub_site_visits").select("project_id, subcontractor_id").gte("visit_date", monday).limit(5000),
    admin
      .from("daily_logs")
      .select("project_id, subcontractor_id")
      .not("subcontractor_id", "is", null)
      .gte("started_at", weekStart)
      .limit(5000),
  ]);
  const bills = must<{
    id: string;
    project_id: string;
    subcontractor_id: string;
    vendor_name: string | null;
    vendor_type: string | null;
    invoice_number: string | null;
    amount: number | string | null;
  }[]>(billsRes, "sub bills this week");
  const seen = new Set<string>();
  for (const r of [
    ...must<{ project_id: string | null; subcontractor_id: string | null }[]>(visitsRes, "visits this week"),
    ...must<{ project_id: string | null; subcontractor_id: string | null }[]>(logsRes, "sub posts this week"),
  ]) {
    if (r.project_id && r.subcontractor_id) seen.add(`${r.subcontractor_id}:${r.project_id}`);
  }

  const subIds = uniq(bills.map((b) => b.subcontractor_id));
  const subName = new Map<string, string>();
  for (const part of chunks(subIds)) {
    const rows = must<{ id: string; company_name: string | null }[]>(
      await admin.from("subcontractors").select("id, company_name").in("id", part),
      "bill subs",
    );
    for (const s of rows) subName.set(s.id, s.company_name ?? "");
  }

  const groups = new Map<string, Omit<BilledNoFieldRecord, "jobShort" | "pmId">>();
  const linesSeen = new Map<string, Set<string>>();
  for (const b of bills) {
    const amount = Number(b.amount ?? 0);
    const company = subName.get(b.subcontractor_id) ?? "";
    const vendor = b.vendor_name ?? "";
    if (!(amount > 0)) continue;
    if (b.vendor_type === "supplier" || isMaterialSupplier(vendor) || isMaterialSupplier(company)) continue;
    if (SERVICE_KEYWORDS.test(vendor) || SERVICE_KEYWORDS.test(company)) continue;
    if (/in.?house|penney construction/i.test(`${vendor} ${company}`)) continue;
    const key = `${b.subcontractor_id}:${b.project_id}`;
    if (seen.has(key)) continue;

    const g = groups.get(key) ?? {
      subId: b.subcontractor_id,
      company: company || vendor || "A sub",
      projectId: b.project_id,
      invoiceNumbers: [],
      amount: 0,
    };
    const lines = linesSeen.get(key) ?? new Set<string>();
    // The same invoice entered twice (router + office) counts once; a split
    // across budget lines (same number, different amounts) counts in full.
    const number = b.invoice_number?.trim() || null;
    const line = number ? `${number}|${amount.toFixed(2)}` : `row:${b.id}`;
    if (!lines.has(line)) {
      lines.add(line);
      g.amount = Math.round((g.amount + amount) * 100) / 100;
    }
    if (number && !g.invoiceNumbers.includes(number)) g.invoiceNumbers.push(number);
    groups.set(key, g);
    linesSeen.set(key, lines);
  }
  return Array.from(groups.values());
}

/** Portal submissions not yet filed. "Filed" = an invoice carries the same attachment path (worked out when read). */
async function loadBillsWaiting(admin: Admin): Promise<{ id: string; projectId: string | null }[]> {
  const subs = must<{ id: string; project_id: string | null; storage_path: string }[]>(
    await admin.from("sub_bill_submissions").select("id, project_id, storage_path").eq("status", "sent").limit(1000),
    "sub bill submissions",
  );
  const filed = new Set<string>();
  for (const part of chunks(uniq(subs.map((s) => s.storage_path)), 100)) {
    const rows = must<{ attachment_storage_path: string | null }[]>(
      await admin.from("invoices").select("attachment_storage_path").in("attachment_storage_path", part),
      "filed sub bills",
    );
    for (const r of rows) if (r.attachment_storage_path) filed.add(r.attachment_storage_path);
  }
  return subs.filter((s) => !filed.has(s.storage_path)).map((s) => ({ id: s.id, projectId: s.project_id }));
}

/**
 * Work phases in the next 14 days with nobody on them: the Subs needed
 * sheet's own rule and window (lib/schedule/subs-needed-rule.ts), so the
 * digest count matches the board chip and every phase it counts can be
 * cleared from the sheet. The live-job filter is applied by the caller.
 */
async function loadUnassignedPhases(admin: Admin, day: string): Promise<{ id: string; projectId: string }[]> {
  const phases = await fetchAllRows<PhaseRow & { master_phase_id: string | null }>((from, to) =>
    admin
      .from("schedule_phases")
      .select("id, project_id, name, start_date, end_date, status, event_type, phase_scope, is_confirmed, planned_start_date, is_manually_scheduled, estimate_line_item_id, assigned_employee_ids, assigned_sub_ids, master_phase_id")
      .lte("start_date", addDays(day, NOBODY_DAYS))
      .gte("end_date", day)
      .order("start_date")
      .order("id")
      .range(from, to),
  );
  return nobodyPhases(phases)
    .filter((ph) => !!ph.project_id)
    .map((ph) => ({ id: ph.id, projectId: ph.project_id as string }));
}

/**
 * Fit the sections into the notice body (the table caps it at 500). Items
 * that don't fit are dropped whole, never cut mid-name, and counted in a
 * closing "+N more."; the tail (the two counts) always fits.
 */
function packBody(sections: { head: string; items: string[] }[], tail: string[], max = BODY_MAX): string {
  const tailText = tail.join(" ");
  const pack = (limit: number) => {
    const out: string[] = [];
    let dropped = 0;
    for (const s of sections) {
      const kept: string[] = [];
      for (const item of s.items) {
        const trial = [...out, `${s.head}${[...kept, item].join("; ")}.`].join(" ");
        if (trial.length <= limit) kept.push(item);
        else dropped++;
      }
      if (kept.length) out.push(`${s.head}${kept.join("; ")}.`);
    }
    return { out, dropped };
  };
  const room = max - (tailText ? tailText.length + 1 : 0);
  let { out, dropped } = pack(room);
  if (dropped) {
    // Pack again leaving room for the "+N more" line.
    ({ out, dropped } = pack(room - " +999 more.".length));
    out.push(`+${dropped} more.`);
  }
  if (tailText) out.push(tailText);
  return out.join(" ").slice(0, max);
}

/** First and last seen, "7:12 AM–3:40 PM" (or one time). */
function seenSpan(r: SubTodayRow): string {
  const first = r.firstSeenAt ? etTimeLabel(r.firstSeenAt) : "";
  const last = r.lastSeenAt ? etTimeLabel(r.lastSeenAt) : "";
  return first && last && last !== first ? `${first}–${last}` : first || last;
}

function composeDigest(
  input: {
    rows: SubTodayRow[];
    billed: BilledNoFieldRecord[];
    unassigned: UnassignedPhase[];
    waiting: SubBillWaiting[];
  },
): { title: string; body: string } | null {
  const { rows, billed, unassigned, waiting } = input;
  const onSite = rows.filter((r) => r.state === "on_site");
  const posted = onSite.filter((r) => r.posts > 0);
  const noPost = onSite.filter((r) => r.posts === 0);
  const noCheckin = rows.filter((r) => r.state === "scheduled_no_checkin");
  const unscheduled = onSite.filter((r) => !r.onSchedule);
  if (!rows.length && !billed.length && !unassigned.length && !waiting.length) return null;

  const titleParts = [
    onSite.length ? `${onSite.length} on site` : "nobody on site",
    noCheckin.length ? `${noCheckin.length} no check-in` : null,
    noPost.length ? `${noPost.length} no post` : null,
    unscheduled.length ? `${unscheduled.length} not on the schedule` : null,
    billed.length ? `${billed.length} billed, no field record` : null,
  ].filter(Boolean);
  const title = `Subs today: ${titleParts.join(" · ")}`;

  // Per job: who posted, first and last seen, posts and photos.
  const byJob = new Map<string, SubTodayRow[]>();
  for (const r of posted) byJob.set(r.projectId, [...(byJob.get(r.projectId) ?? []), r]);
  const sections: { head: string; items: string[] }[] = Array.from(byJob.values()).map((list) => ({
    head: `${list[0].jobShort}: `,
    items: list.map((r) =>
      [r.label, seenSpan(r), plural(r.posts, "post"), r.photos ? plural(r.photos, "photo") : null].filter(Boolean).join(", "),
    ),
  }));
  const at = (r: SubTodayRow) => `${r.label} at ${r.jobShort}`;
  if (noPost.length) {
    sections.push({
      head: "On site, no post: ",
      items: noPost.map((r) => [at(r), seenSpan(r)].filter(Boolean).join(", ")),
    });
  }
  if (noCheckin.length) sections.push({ head: "Scheduled, no check-in: ", items: noCheckin.map(at) });
  if (unscheduled.length) sections.push({ head: "Not on the schedule: ", items: unscheduled.map(at) });
  if (billed.length) {
    sections.push({
      head: "Billed, no field record: ",
      items: billed.map((b) => `${b.company} ${formatMoney(b.amount, { cents: "always" })} at ${b.jobShort}`),
    });
  }

  const tail: string[] = [];
  if (unassigned.length) {
    const jobs = new Set(unassigned.map((u) => u.projectId)).size;
    tail.push(`Phases next 14 days with nobody: ${unassigned.length} on ${plural(jobs, "job")}.`);
  }
  if (waiting.length) tail.push(`Sub bills waiting to be filed: ${waiting.length}.`);

  return { title, body: packBody(sections, tail) };
}

/**
 * Everything the digest says, per recipient, without writing anything.
 * Recipients: Jorge (every job), plus each PM whose jobs had a sub on site
 * or scheduled today (their jobs only).
 */
export async function buildSubDigest(admin: Admin, { now = new Date() }: { now?: Date } = {}): Promise<SubDigestBuild> {
  const today = await loadSubDay(admin, { now });
  const [billedRaw, waitingRaw, unassignedRaw, jorgeRes] = await Promise.all([
    loadBilledNoFieldRecord(admin, now),
    loadBillsWaiting(admin),
    loadUnassignedPhases(admin, today.day),
    resolveSubNoticeRecipients(admin, { projectId: null, audience: ["jorge"] }),
  ]);

  const projects = await loadProjects(admin, [
    ...billedRaw.map((b) => b.projectId),
    ...waitingRaw.map((w) => w.projectId),
    ...unassignedRaw.map((u) => u.projectId),
  ].filter((id): id is string => !!id));

  const billedNoFieldRecord: BilledNoFieldRecord[] = billedRaw.flatMap((b) => {
    const p = projects.get(b.projectId);
    return isTrackedJob(p) ? [{ ...b, jobShort: shortJobName(p.name), pmId: p.assigned_pm }] : [];
  });
  const billsWaiting: SubBillWaiting[] = waitingRaw.map((w) => ({
    ...w,
    pmId: w.projectId ? (projects.get(w.projectId)?.assigned_pm ?? null) : null,
  }));
  const unassignedPhases: UnassignedPhase[] = unassignedRaw.flatMap((u) => {
    const p = projects.get(u.projectId);
    // The chip's job set: live (in progress, contracted, on hold), not Office/Shop.
    return isTrackedJob(p) && isSubLiveStatus(p.status) ? [{ ...u, pmId: p.assigned_pm }] : [];
  });

  // Who gets one.
  const jorge = jorgeRes.recipients[0] ?? null;
  const pmIds = uniq(today.rows.map((r) => r.pmId)).filter((id) => id !== jorge?.id);
  const pmProfiles = pmIds.length
    ? must<{ id: string; full_name: string | null }[]>(
        await admin.from("profiles").select("id, full_name").in("id", pmIds),
        "PM profiles",
      )
    : [];

  const deliveries: SubDigestDeliveryDraft[] = [];
  if (jorge) {
    const text = composeDigest({
      rows: today.rows,
      billed: billedNoFieldRecord,
      unassigned: unassignedPhases,
      waiting: billsWaiting,
    });
    if (text) deliveries.push({ profileId: jorge.id, name: jorge.full_name ?? "Jorge", scope: "all", ...text });
  }
  for (const pm of pmProfiles) {
    const mine = <T extends { pmId: string | null }>(list: T[]) => list.filter((x) => x.pmId === pm.id);
    const rows = mine(today.rows);
    // A PM hears about a day only when a sub was on, or due on, one of their jobs.
    if (!rows.length) continue;
    const text = composeDigest({
      rows,
      billed: mine(billedNoFieldRecord),
      unassigned: mine(unassignedPhases),
      waiting: mine(billsWaiting),
    });
    if (text) deliveries.push({ profileId: pm.id, name: pm.full_name ?? "PM", scope: "pm", ...text });
  }

  // Who will only see it in the bell.
  const recipientIds = deliveries.map((d) => d.profileId);
  const pushRows = recipientIds.length
    ? must<{ user_id: string | null }[]>(
        await admin.from("push_subscriptions").select("user_id").in("user_id", recipientIds),
        "push subscriptions",
      )
    : [];
  const withPush = new Set(pushRows.map((r) => r.user_id).filter(Boolean));
  const withoutPush = deliveries.filter((d) => !withPush.has(d.profileId)).map((d) => ({ profileId: d.profileId, name: d.name }));

  return {
    day: today.day,
    generatedAt: now.toISOString(),
    today,
    billedNoFieldRecord,
    unassignedPhases,
    billsWaiting,
    deliveries,
    withoutPush,
  };
}

export interface SubDigestRun {
  day: string;
  dry: boolean;
  recipients: { name: string; scope: "all" | "pm"; title: string; body?: string }[];
  withoutPush: string[];
  counts: SubsToday["counts"] & { billedNoFieldRecord: number; unassignedPhases: number; billsWaiting: number };
  notice: SubNoticeResult | null;
}

/**
 * Build the digest and, unless `dry`, write it: one in-app row per recipient
 * for the ET day (keyed by subDigestSourceId), pushed on insert. A second
 * run the same day rewrites the text and pushes nobody.
 */
export async function runSubDigest(admin: Admin, { now = new Date(), dry = false }: { now?: Date; dry?: boolean } = {}): Promise<SubDigestRun> {
  const build = await buildSubDigest(admin, { now });
  const notice =
    dry || build.deliveries.length === 0
      ? null
      : await notifySubDigest({
          day: build.day,
          deliveries: build.deliveries.map((d) => ({ profileId: d.profileId, title: d.title, body: d.body })),
          url: "/board",
        });
  return {
    day: build.day,
    dry,
    recipients: build.deliveries.map((d) => ({
      name: d.name,
      scope: d.scope,
      title: d.title,
      ...(dry ? { body: d.body } : {}),
    })),
    withoutPush: build.withoutPush.map((p) => p.name),
    counts: {
      ...build.today.counts,
      billedNoFieldRecord: build.billedNoFieldRecord.length,
      unassignedPhases: build.unassignedPhases.length,
      billsWaiting: build.billsWaiting.length,
    },
    notice,
  };
}
