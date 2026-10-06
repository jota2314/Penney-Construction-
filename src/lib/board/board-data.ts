import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  getSiteForecasts,
  siteKey,
  phaseRiskOn,
  isExteriorPhase,
  type ForecastIndex,
  type DayWeather,
} from "@/lib/weather/forecast";

/**
 * Everything the job board renders, assembled server-side.
 *
 * The board splits into three lanes because the jobs genuinely differ in
 * kind, not just in status:
 *
 *   ON SITE      in_progress — has crews, phases, logs. Gets the day grid.
 *   STARTING     contracted  — signed but not started. Gets a countdown.
 *   PIPELINE     proposal_sent / estimating — no dates exist yet. Gets pills.
 *
 * The old single-table board gave all three the same 68 day-columns, so 43 of
 * 51 rows rendered empty. A proposal-sent job has nothing to draw on a
 * calendar; an in-construction job with no schedule is a problem worth
 * showing. Those are different facts and the board now says so.
 */

// Six weeks back and four months forward, so a whole job — what's done and
// what's left, not just the next two months of it — fits on the timeline when
// Jorge zooms out to plan it.
export const DAYS_BACK = 42;
export const DAYS_FORWARD = 120;

const ONSITE_STATUSES = ["in_progress"] as const;
const STARTING_STATUSES = ["contracted"] as const;
const PIPELINE_STATUSES = ["proposal_sent", "estimating"] as const;

/**
 * Event types that are not construction work. They belong on the board, but a
 * job's projected finish must never be derived from one.
 */
const NON_WORK_EVENTS = new Set(["meeting", "shop_meeting", "walkthrough"]);

/** Same-day events: drawn as a marker on the day, never as a run of work. */
const MILESTONE_EVENTS = new Set(["inspection", "meeting", "shop_meeting", "walkthrough"]);

/** Names the general clock-in paths give the row they spawn. */
const CLOCK_IN_NAMES = new Set(["Needs allocation", "Change order work"]);

/**
 * A clock-in leftover, not a plan. Clocking in on a budget line with no
 * phase covering today spawns a one-day `daily` row named after the line
 * ("Dumpster & Waste", "Needs allocation") that sits `in_progress` forever.
 * Those are attendance records — the time logs already say who worked — and
 * on the plan they buried the real sequence.
 *
 * Every trait has to match, because planned daily steps get marked done too
 * (schedule chat, the MCP tools, the project page) and those must stay: a
 * clock-in row is never confirmed, never has planned dates, is one day long,
 * and is either still open or carries the budget line / generic name the
 * clock-in gave it. (10/5: 41 real completed steps were hiding under the
 * looser test.)
 */
export function isClockInRow(ph: {
  phase_scope: string | null;
  event_type: string | null;
  status: string;
  name: string;
  start_date: string;
  end_date?: string | null;
  is_confirmed?: boolean | null;
  planned_start_date?: string | null;
  estimate_line_item_id?: string | null;
}) {
  if (ph.phase_scope !== "daily") return false;
  if (ph.event_type !== null && ph.event_type !== "phase") return false;
  if (ph.status === "not_started" || ph.is_confirmed || ph.planned_start_date) return false;
  if ((ph.end_date || ph.start_date) !== ph.start_date) return false;
  return ph.status === "in_progress" || !!ph.estimate_line_item_id || CLOCK_IN_NAMES.has(ph.name);
}

function barKind(eventType: string | null): BarKind {
  if (eventType === "crew") return "crew";
  if (eventType === "work") return "sub";
  return "plan";
}

const ALL_STATUSES = [
  ...ONSITE_STATUSES,
  ...STARTING_STATUSES,
  ...PIPELINE_STATUSES,
];

// ── Date helpers (local time, YYYY-MM-DD keys) ───────────────────

export function dateToStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Today's date in Peabody, not on the server. Vercel runs in UTC, so after
 * 8pm Eastern a plain `new Date()` already reads tomorrow and the board's
 * "today" column jumped a day ahead every evening.
 */
export function easternToday() {
  return easternDate(new Date());
}

/** A timestamp's calendar date in Eastern time. */
export function easternDate(at: Date | string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof at === "string" ? new Date(at) : at);
}

export function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysBetween(from: string, to: string) {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

// ── Shapes ───────────────────────────────────────────────────────

export interface BoardDay {
  str: string;
  dayName: string;
  label: string;
  isWeekend: boolean;
  isToday: boolean;
  isPast: boolean;
  monthLabel: string | null;
}

/** A phase resolved to grid coordinates so the client draws one span, not N stubs. */
export interface BoardBar {
  id: string;
  projectId: string;
  name: string;
  color: string;
  status: string;
  eventType: string | null;
  /** 1-based column index into `days`, clamped to the window. */
  startCol: number;
  /** Inclusive end column. */
  endCol: number;
  /** True when the phase runs past either edge of the window. */
  clippedStart: boolean;
  clippedEnd: boolean;
  /** Planned span, when it differs from the live one. Drawn as a dashed ghost. */
  planned: { startCol: number; endCol: number } | null;
  /** Days late the live start is vs the planned start. Negative = early. */
  slipDays: number | null;
  isConfirmed: boolean;
  isExterior: boolean;
  /** Wet/cold/windy days this phase overlaps, in date order. */
  risks: { date: string; reason: string }[];
  crew: string[];
  /** Raw dates, so a drag can compute the new span without re-deriving columns. */
  startDate: string;
  endDate: string;
  /** Who is on it — the panel edits these directly. */
  assignedEmployeeIds: string[];
  assignedSubIds: string[];
  subs: string[];
  /** Carried so the panel can title itself without a lookup. */
  projectName: string;
  /** The actual scope of work for this phase. */
  description: string | null;
  notes: string | null;
  /**
   * `master` or `daily` — which schedule the phase belongs to, NOT a scope of
   * work. Only `master` phases reach the client portal, so it's worth showing.
   */
  phaseScope: string | null;
  /**
   * `plan`  — a step in the job's sequence (the master schedule, or a dated
   *           item the office or the AI put on the calendar).
   * `crew`  — a person-by-day assignment from the Crew grid.
   * `sub`   — the sub proposed it from their portal.
   */
  kind: BarKind;
  /**
   * Every `schedule_phases` row this bar stands for. The Crew grid writes one
   * row per person, so "Railings + caps" for Jerson and for Seij is two rows —
   * the board draws it once, with both names, and moves both together.
   */
  memberIds: string[];
  /** A same-day event (inspection, meeting, walkthrough) — drawn as a marker, not a run. */
  isMilestone: boolean;
}

export type BarKind = "plan" | "crew" | "sub";

export interface BoardMarker {
  id: string;
  projectId: string;
  col: number;
  kind: "order" | "todo";
  label: string;
  overdue: boolean;
}

/**
 * A contract payment resolved onto the calendar.
 *
 * `project_payment_milestones` rows carry a `stage_key` but NO date — they say
 * "when the roughs pass" not "on October 3rd". The date comes from matching
 * that stage to the schedule phase that satisfies it, so the board can answer
 * the question the table never could: what day do we actually get paid.
 */
export interface BoardPayment {
  id: string;
  projectId: string;
  label: string;
  /** Null for viewers who can't see money. */
  amount: number | null;
  status: string;
  stageKey: string | null;
  date: string | null;
  col: number | null;
  /** The phase whose completion triggers this payment. */
  anchor: string | null;
  /** Every phase this draw waits on — usually more than one. */
  requires: string[];
}

export interface BoardCrew {
  id: string;
  name: string;
  initials: string;
  clockedIn: boolean;
}

export interface BoardJob {
  id: string;
  name: string;
  projectNumber: string;
  status: string;
  phase: string | null;
  city: string | null;
  /** Grid key into the forecast index. */
  site: string;
  /** Null for viewers who can't see money. */
  contractValue: number | null;
  /** Projected finish: last scheduled phase, else the estimated end date. */
  closeDate: string | null;
  closeSource: "schedule" | "estimate" | null;
  /** Days between the projected finish and `estimated_end_date`. */
  closeSlipDays: number | null;
  /** Days until work starts, for the STARTING lane. */
  startsInDays: number | null;
  startDate: string | null;
  bars: BoardBar[];
  markers: BoardMarker[];
  crewToday: BoardCrew[];
  lastLog: { text: string; at: string; author: string } | null;
  daysSinceLastLog: number | null;
  openTodoCount: number;
  unsignedCoCount: number;
  /** Contract payments mapped onto the grid. */
  payments: BoardPayment[];
  /**
   * Cash in and cash out, both null for viewers who can't see money.
   * `spent` is the same figure /spent and the Finances tab use — every
   * invoices row, which includes in-house labor booked against the job.
   */
  received: number | null;
  spent: number | null;
  /** in_progress with nothing on the calendar — the thing the old board hid. */
  unscheduled: boolean;
  /** The plan step running today, if any. */
  nowStep: { name: string; endDate: string } | null;
  /** The next plan step that hasn't started — and whether anyone confirmed it. */
  nextStep: { name: string; startDate: string; confirmed: boolean } | null;
  /** Master steps whose end date has passed and are still open. */
  overdueCount: number;
  /** Nothing at all — plan, crew or sub — is on the calendar from today on. */
  nothingAhead: boolean;
  /** Days inside the window somebody clocked in on this job (Eastern dates). */
  workedDays: string[];
  /** Clock-in records kept off the plan. */
  hiddenClockIns: number;
  /** First and last day of real work on the schedule, for "fit the whole job". */
  spanStart: string | null;
  spanEnd: string | null;
  /**
   * Open plan steps that start past the window. No bar is drawn for them,
   * but "move this and everything after" has to carry them along.
   */
  laterSteps: { id: string; startDate: string; endDate: string }[];
}

export interface BoardData {
  days: BoardDay[];
  todayStr: string;
  onsite: BoardJob[];
  starting: BoardJob[];
  pipeline: BoardJob[];
  /** Day-by-day weather for the whole window, per jobsite grid cell. */
  weather: Record<string, Record<string, DayWeather>>;
  /** Hour-by-hour for today, keyed the same way. Used by TV mode. */
  hourly: Record<string, { hour: number; icon: string; temp: number; precipChance: number; wet: boolean }[]>;
  /** The site every job falls back to when it has no coordinates. */
  defaultSite: string;
  canSeeMoney: boolean;
  /** Everything still collectable that lands inside the visible window. */
  dueInWindow: number;
}

// ── Row types straight off the query ─────────────────────────────

interface ProjectRow {
  id: string;
  name: string;
  project_number: string;
  status: string;
  phase: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  contract_value: number | null;
  estimated_value: number | null;
  estimated_start_date: string | null;
  estimated_end_date: string | null;
  actual_start_date: string | null;
}

interface PhaseRow {
  id: string;
  project_id: string | null;
  name: string;
  start_date: string;
  end_date: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  status: string;
  color: string | null;
  event_type: string | null;
  is_confirmed: boolean | null;
  assigned_employee_ids: string[] | null;
  assigned_sub_ids: string[] | null;
  phase_scope: string | null;
  description: string | null;
  notes: string | null;
  estimate_line_item_id: string | null;
}

interface LogRow {
  id: string;
  project_id: string | null;
  author_id: string | null;
  text: string | null;
  started_at: string;
  ended_at: string | null;
  status: string | null;
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Build the window of days. A month label is attached to the first column of
 * each month so the header can print "September" once instead of on all 30.
 */
function buildDays(todayStr: string): BoardDay[] {
  // Anchor on noon of Eastern "today" so local date maths can't drift a day.
  const start = addDays(new Date(`${todayStr}T12:00:00`), -DAYS_BACK);
  let lastMonth = "";
  return Array.from({ length: DAYS_BACK + DAYS_FORWARD + 1 }, (_, i) => {
    const d = addDays(start, i);
    const str = dateToStr(d);
    const month = d.toLocaleDateString("en-US", { month: "long" });
    const monthLabel = month === lastMonth ? null : month;
    lastMonth = month;
    return {
      str,
      dayName: d.toLocaleDateString("en-US", { weekday: "short" }),
      label: d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }),
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      isToday: str === todayStr,
      isPast: str < todayStr,
      monthLabel,
    };
  });
}

/**
 * Resolve a date span to inclusive 1-based column indices, or null when the
 * span misses the window entirely. Clipping is reported so the client can
 * draw a torn edge instead of pretending the phase starts at the window edge.
 */
function toColumns(
  start: string,
  end: string,
  colOf: Map<string, number>,
  firstStr: string,
  lastStr: string,
) {
  if (end < firstStr || start > lastStr) return null;
  const clippedStart = start < firstStr;
  const clippedEnd = end > lastStr;
  const startCol = colOf.get(clippedStart ? firstStr : start);
  const endCol = colOf.get(clippedEnd ? lastStr : end);
  if (!startCol || !endCol) return null;
  return { startCol, endCol, clippedStart, clippedEnd };
}

/**
 * Which schedule phase marks a payment stage as earned, most specific first.
 * These are matched against the lowercased phase name; the first pattern that
 * hits any phase wins, and the LAST such phase's end date is the collect date.
 */
const STAGE_ANCHORS: Record<string, RegExp[]> = {
  deposit: [/deposit|mobilization|pre-con/],
  weathertight: [/roof complete|weathertight|dry-in/, /roofing|copper|siding/],
  close_in: [/closed in/, /blueboard|plaster|drywall/],
  rough_inspection: [/rough inspection/, /inspection — rough/, /rough-ins|rough plumbing|rough electrical/],
  finish: [/floors \+ kitchen|finish complete/, /kitchen install|cabinet install/, /flooring|hardwood/],
  final: [/substantial completion/, /final inspection|final building/, /punch/],
  final_inspection: [/final inspection|final building/, /substantial completion/, /punch/],
  substantial_completion: [/substantial completion/, /punch/, /final inspection/],
};

/**
 * Trades a milestone label can name, and the phases that satisfy each.
 *
 * These are CONJUNCTIONS, not alternatives. "Tile, plaster, cabinets &
 * flooring complete" is not earned when the plaster finishes — it is earned
 * when the LAST of those four finishes. Taking the first keyword that matched
 * dated that draw weeks early.
 */
const TRADE_HINTS: [RegExp, RegExp][] = [
  [/foundation|footing/, /foundation|footing|concrete/],
  [/fram/, /framing|structural/],
  [/roof|shingle|copper/, /roof|copper|dry-in/],
  [/sid(e|ing)/, /siding/],
  [/window|exterior door/, /window|french door|slider/],
  [/rough/, /rough inspection|inspection — rough|rough-ins|rough plumbing|rough electrical/],
  [/insulat/, /insulation/],
  [/blueboard|plaster|drywall/, /blueboard|plaster|drywall/],
  [/tile/, /tile|backsplash/],
  [/trim|millwork|carpentry/, /trim|millwork|finish carpentry/],
  [/cabinet|kitchen/, /cabinet|kitchen install/],
  [/counter/, /countertop|counters/],
  [/floor/, /flooring|hardwood|lvp/],
  [/paint/, /paint/],
  [/appliance/, /appliance/],
  [/deck|porch|stair/, /deck|porch|stair|railing/],
  [/punch|final|substantial|completion/, /substantial completion|punch|final inspection|final building/],
];

interface AnchorPhase {
  name: string;
  end: string;
}

export interface PaymentAnchor {
  /** The phase whose completion dates the payment — the last one required. */
  name: string;
  end: string;
  /** Every phase this draw waits on, so the tooltip can show its reasoning. */
  requires: string[];
}

/** Latest-ending phase matching a pattern, or null. */
function lastMatching(phases: AnchorPhase[], re: RegExp): AnchorPhase | null {
  const hits = phases.filter((ph) => re.test(ph.name.toLowerCase()));
  if (hits.length === 0) return null;
  return hits.reduce((a, b) => (b.end > a.end ? b : a));
}

/**
 * Resolve one milestone to the date it becomes collectable.
 *
 * The label wins when it names trades, because it is the more specific
 * statement of what has to be finished; the stage_key is only a fallback for
 * labels that say nothing useful. Returns null when nothing in the schedule
 * plausibly represents the stage — better a blank than a made-up payday.
 */
function resolvePaymentDate(
  stageKey: string | null,
  label: string,
  phases: AnchorPhase[],
): PaymentAnchor | null {
  if (phases.length === 0) return null;
  const lower = label.toLowerCase();

  // Every trade the label names must be complete — take the latest.
  const required: AnchorPhase[] = [];
  for (const [labelRe, phaseRe] of TRADE_HINTS) {
    if (!labelRe.test(lower)) continue;
    const hit = lastMatching(phases, phaseRe);
    if (hit) required.push(hit);
  }

  if (required.length > 0) {
    const latest = required.reduce((a, b) => (b.end > a.end ? b : a));
    return {
      name: latest.name,
      end: latest.end,
      requires: Array.from(new Set(required.map((r) => r.name))),
    };
  }

  // Nothing recognisable in the label — fall back to the stage key.
  for (const re of STAGE_ANCHORS[stageKey ?? ""] ?? []) {
    const hit = lastMatching(phases, re);
    if (hit) return { name: hit.name, end: hit.end, requires: [hit.name] };
  }
  return null;
}

/**
 * Fold per-person crew rows into one bar: same job, same words, same days,
 * same confirmation. Names and ids are unioned so the bar reads "Jerson,
 * Seij" and a drag moves every row behind it.
 */
function mergeCrewBars(bars: BoardBar[]): BoardBar[] {
  const out: BoardBar[] = [];
  const byKey = new Map<string, BoardBar>();
  for (const bar of bars) {
    if (bar.kind !== "crew") {
      out.push(bar);
      continue;
    }
    const key = [bar.name, bar.startDate, bar.endDate, bar.isConfirmed, bar.status].join("|");
    const hit = byKey.get(key);
    if (!hit) {
      const copy = { ...bar, memberIds: [...bar.memberIds] };
      byKey.set(key, copy);
      out.push(copy);
      continue;
    }
    hit.memberIds.push(...bar.memberIds);
    hit.crew = Array.from(new Set([...hit.crew, ...bar.crew]));
    hit.subs = Array.from(new Set([...hit.subs, ...bar.subs]));
    hit.assignedEmployeeIds = Array.from(
      new Set([...hit.assignedEmployeeIds, ...bar.assignedEmployeeIds]),
    );
    hit.assignedSubIds = Array.from(new Set([...hit.assignedSubIds, ...bar.assignedSubIds]));
  }
  return out;
}

export async function getBoardData(canSeeMoney: boolean): Promise<BoardData> {
  const supabase = await createClient();
  const todayStr = easternToday();
  const days = buildDays(todayStr);
  const firstStr = days[0].str;
  const lastStr = days[days.length - 1].str;
  const colOf = new Map(days.map((d, i) => [d.str, i + 1]));

  const { data: projectRows } = await supabase
    .from("projects")
    // One unbroken literal: supabase-js infers the row type by parsing this
    // string, and a concatenation widens it to `string`, which silently
    // degrades every field to an error type.
    .select("id, name, project_number, status, phase, city, latitude, longitude, contract_value, estimated_value, estimated_start_date, estimated_end_date, actual_start_date")
    .in("status", ALL_STATUSES)
    .eq("is_overhead", false)
    .order("created_at", { ascending: false });

  const projects = (projectRows ?? []) as ProjectRow[];
  const ids = projects.map((p) => p.id);

  const empty = { data: null } as const;
  const [
    { data: phaseRows },
    { data: orderRows },
    { data: todoRows },
    { data: logRows },
    { data: coRows },
    { data: employeeRows },
    { data: subRows },
    { data: invoiceRows },
    { data: receiptRows },
    { data: milestoneRows },
  ] = await Promise.all([
    // Every phase of every job, paged: PostgREST silently stops at 1000 rows
    // and these are ordered oldest first, so a cap would drop the NEWEST
    // steps. Past the window still matters — "last work" and "everything
    // after this" both need the steps the timeline can't draw yet.
    ids.length
      ? fetchAllRows<PhaseRow>((from, to) =>
          supabase
            .from("schedule_phases")
            .select("id, project_id, name, description, notes, start_date, end_date, planned_start_date, planned_end_date, status, color, event_type, is_confirmed, assigned_employee_ids, assigned_sub_ids, phase_scope, estimate_line_item_id")
            .in("project_id", ids)
            .not("start_date", "is", null)
            .order("start_date")
            .order("id")
            .range(from, to),
        ).then((rows) => ({ data: rows }))
      : empty,
    ids.length
      ? supabase
          .from("material_orders")
          .select("id, project_id, order_number, status, needed_by, notes, material_order_items(item_name)")
          .in("project_id", ids)
          .in("status", ["pending", "approved", "ready"])
      : empty,
    ids.length
      ? supabase
          .from("todos")
          .select("id, project_id, description, due_date, priority")
          .in("project_id", ids)
          .eq("status", "open")
      : empty,
    ids.length
      ? supabase
          .from("daily_logs")
          .select("id, project_id, author_id, text, started_at, ended_at, status")
          .in("project_id", ids)
          // The whole window, so worked-day ticks reach as far back as it does.
          .gte("started_at", new Date(Date.now() - (DAYS_BACK + 1) * 86400000).toISOString())
          .order("started_at", { ascending: false })
          .limit(1000)
      : empty,
    ids.length
      ? supabase
          .from("change_orders")
          .select("id, project_id, status")
          .in("project_id", ids)
          .not("status", "in", '("approved","rejected","cancelled")')
      : empty,
    supabase.from("employees").select("id, first_name, last_name, profile_id"),
    supabase.from("subcontractors").select("id, company_name"),
    ids.length
      ? supabase.from("invoices").select("project_id, amount, paid_amount").in("project_id", ids)
      : empty,
    ids.length
      ? supabase.from("payments_received").select("project_id, amount").in("project_id", ids)
      : empty,
    ids.length
      ? supabase
          .from("project_payment_milestones")
          .select("id, project_id, label, stage_key, amount, percent, status, sort_order")
          .in("project_id", ids)
          .order("sort_order")
      : empty,
  ]);

  // ── Lookups ────────────────────────────────────────────────────

  const employeeName = new Map<string, string>();
  for (const e of (employeeRows ?? []) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
  }[]) {
    employeeName.set(e.id, [e.first_name, e.last_name].filter(Boolean).join(" ").trim());
  }

  // Cash out: every booked bill on the job, vendor and in-house labor alike.
  const spentByProject = new Map<string, number>();
  for (const inv of (invoiceRows ?? []) as {
    project_id: string | null;
    amount: number | null;
    paid_amount: number | null;
  }[]) {
    if (!inv.project_id) continue;
    const value = Number(inv.paid_amount ?? inv.amount ?? 0);
    spentByProject.set(inv.project_id, (spentByProject.get(inv.project_id) ?? 0) + value);
  }

  // Cash in: what the client has actually paid.
  const receivedByProject = new Map<string, number>();
  for (const r of (receiptRows ?? []) as { project_id: string | null; amount: number | null }[]) {
    if (!r.project_id) continue;
    receivedByProject.set(
      r.project_id,
      (receivedByProject.get(r.project_id) ?? 0) + Number(r.amount ?? 0),
    );
  }

  const milestonesByProject = new Map<
    string,
    { id: string; label: string; stage_key: string | null; amount: number | null; percent: number | null; status: string }[]
  >();
  for (const m of (milestoneRows ?? []) as {
    id: string;
    project_id: string | null;
    label: string;
    stage_key: string | null;
    amount: number | null;
    percent: number | null;
    status: string;
  }[]) {
    if (!m.project_id) continue;
    const arr = milestonesByProject.get(m.project_id);
    if (arr) arr.push(m);
    else milestonesByProject.set(m.project_id, [m]);
  }

  const subName = new Map<string, string>();
  for (const sc of (subRows ?? []) as { id: string; company_name: string | null }[]) {
    subName.set(sc.id, sc.company_name ?? "");
  }

  // Author names for field logs come from profiles; one small extra read.
  const authorIds = Array.from(
    new Set(((logRows ?? []) as LogRow[]).map((l) => l.author_id).filter(Boolean) as string[]),
  );
  const authorName = new Map<string, string>();
  if (authorIds.length) {
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);
    for (const p of (profileRows ?? []) as { id: string; full_name: string | null }[]) {
      authorName.set(p.id, p.full_name ?? "");
    }
  }

  const phasesByProject = new Map<string, PhaseRow[]>();
  for (const ph of (phaseRows ?? []) as PhaseRow[]) {
    if (!ph.project_id) continue;
    const arr = phasesByProject.get(ph.project_id);
    if (arr) arr.push(ph);
    else phasesByProject.set(ph.project_id, [ph]);
  }

  const logsByProject = new Map<string, LogRow[]>();
  for (const l of (logRows ?? []) as LogRow[]) {
    if (!l.project_id) continue;
    const arr = logsByProject.get(l.project_id);
    if (arr) arr.push(l);
    else logsByProject.set(l.project_id, [l]);
  }

  const openTodos = new Map<string, number>();
  const todosByCell = new Map<string, { id: string; description: string; due_date: string }[]>();
  for (const t of (todoRows ?? []) as {
    id: string;
    project_id: string | null;
    description: string;
    due_date: string | null;
  }[]) {
    if (!t.project_id) continue;
    openTodos.set(t.project_id, (openTodos.get(t.project_id) ?? 0) + 1);
    if (!t.due_date) continue;
    const key = t.project_id;
    const arr = todosByCell.get(key);
    const row = { id: t.id, description: t.description, due_date: t.due_date };
    if (arr) arr.push(row);
    else todosByCell.set(key, [row]);
  }

  const ordersByProject = new Map<
    string,
    { id: string; label: string; needed_by: string; status: string }[]
  >();
  for (const o of (orderRows ?? []) as {
    id: string;
    project_id: string | null;
    order_number: string;
    status: string;
    needed_by: string | null;
    notes: string | null;
    material_order_items: { item_name: string }[] | null;
  }[]) {
    if (!o.project_id || !o.needed_by) continue;
    const label = o.material_order_items?.[0]?.item_name || o.notes || o.order_number;
    const arr = ordersByProject.get(o.project_id);
    const row = { id: o.id, label, needed_by: o.needed_by, status: o.status };
    if (arr) arr.push(row);
    else ordersByProject.set(o.project_id, [row]);
  }

  const unsignedCos = new Map<string, number>();
  for (const c of (coRows ?? []) as { project_id: string | null }[]) {
    if (!c.project_id) continue;
    unsignedCos.set(c.project_id, (unsignedCos.get(c.project_id) ?? 0) + 1);
  }

  // ── Weather, one round trip for every distinct site ────────────

  const forecasts: ForecastIndex = await getSiteForecasts(
    projects.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
  );

  const weather: BoardData["weather"] = {};
  const hourly: BoardData["hourly"] = {};
  for (const [key, f] of forecasts) {
    weather[key] = Object.fromEntries(f.days);
    hourly[key] = f.hours
      .filter((h) => h.date === todayStr)
      .map((h) => ({ hour: h.hour, icon: h.icon, temp: h.temp, precipChance: h.precipChance, wet: h.wet }));
  }

  // ── Per-job assembly ───────────────────────────────────────────

  function buildJob(p: ProjectRow): BoardJob {
    const site = siteKey(p);
    const siteDays = forecasts.get(site)?.days;
    const phases = phasesByProject.get(p.id) ?? [];
    const logs = logsByProject.get(p.id) ?? [];

    const bars: BoardBar[] = [];
    let hiddenClockIns = 0;
    for (const ph of phases) {
      const end = ph.end_date || ph.start_date;
      if (isClockInRow(ph)) {
        if (end >= firstStr) hiddenClockIns++;
        continue;
      }
      const cols = toColumns(ph.start_date, end, colOf, firstStr, lastStr);
      if (!cols) continue;

      // Planned ghost only when the live dates actually moved off plan.
      let planned: BoardBar["planned"] = null;
      let slipDays: number | null = null;
      if (ph.planned_start_date) {
        slipDays = daysBetween(ph.planned_start_date, ph.start_date);
        const plannedEnd = ph.planned_end_date || ph.planned_start_date;
        if (ph.planned_start_date !== ph.start_date || plannedEnd !== end) {
          const pc = toColumns(ph.planned_start_date, plannedEnd, colOf, firstStr, lastStr);
          if (pc) planned = { startCol: pc.startCol, endCol: pc.endCol };
        }
      }

      // Which days inside this phase's span are bad for outdoor work.
      const risks: BoardBar["risks"] = [];
      if (isExteriorPhase(ph.name) && siteDays) {
        for (let c = cols.startCol; c <= cols.endCol; c++) {
          const day = siteDays.get(days[c - 1].str);
          if (days[c - 1].isPast) continue;
          const risk = phaseRiskOn(ph.name, day);
          if (risk) risks.push(risk);
        }
      }

      bars.push({
        id: ph.id,
        projectId: p.id,
        name: ph.name,
        color: ph.color || "#f59e0b",
        status: ph.status,
        eventType: ph.event_type,
        startCol: cols.startCol,
        endCol: cols.endCol,
        clippedStart: cols.clippedStart,
        clippedEnd: cols.clippedEnd,
        planned,
        slipDays,
        isConfirmed: !!ph.is_confirmed,
        isExterior: isExteriorPhase(ph.name),
        risks,
        crew: (ph.assigned_employee_ids ?? [])
          .map((id) => employeeName.get(id))
          .filter((n): n is string => !!n),
        subs: (ph.assigned_sub_ids ?? [])
          .map((id) => subName.get(id))
          .filter((n): n is string => !!n),
        startDate: ph.start_date,
        endDate: end,
        assignedEmployeeIds: ph.assigned_employee_ids ?? [],
        assignedSubIds: ph.assigned_sub_ids ?? [],
        projectName: p.name,
        description: ph.description,
        notes: ph.notes,
        phaseScope: ph.phase_scope,
        kind: barKind(ph.event_type),
        memberIds: [ph.id],
        isMilestone: MILESTONE_EVENTS.has(ph.event_type ?? ""),
      });
    }
    const mergedBars = mergeCrewBars(bars);

    const markers: BoardMarker[] = [];
    for (const o of ordersByProject.get(p.id) ?? []) {
      const col = colOf.get(o.needed_by);
      if (!col) continue;
      markers.push({
        id: o.id,
        projectId: p.id,
        col,
        kind: "order",
        label: o.label,
        overdue: o.needed_by < todayStr && o.status !== "ready",
      });
    }
    for (const t of todosByCell.get(p.id) ?? []) {
      const col = colOf.get(t.due_date);
      if (!col) continue;
      markers.push({
        id: t.id,
        projectId: p.id,
        col,
        kind: "todo",
        label: t.description,
        overdue: t.due_date < todayStr,
      });
    }

    // Who was on site today — a log started today, still open or completed.
    const crewSeen = new Map<string, BoardCrew>();
    for (const l of logs) {
      if (easternDate(l.started_at) !== todayStr) continue;
      if (!l.author_id) continue;
      const name = authorName.get(l.author_id) || "Crew";
      const existing = crewSeen.get(l.author_id);
      const clockedIn = !l.ended_at;
      if (existing) {
        existing.clockedIn = existing.clockedIn || clockedIn;
      } else {
        crewSeen.set(l.author_id, {
          id: l.author_id,
          name,
          initials: initialsOf(name) || "··",
          clockedIn,
        });
      }
    }

    const lastNarrative = logs.find((l) => l.text && l.text.trim().length > 10);
    const lastAny = logs[0];
    const daysSinceLastLog = lastAny
      ? Math.floor((Date.now() - new Date(lastAny.started_at).getTime()) / 86400000)
      : null;

    // Projected finish: the last day real WORK is scheduled, else the estimate.
    // Meetings, walkthroughs, and the recurring Monday shop meeting are
    // excluded — otherwise the Shop cost centre "finishes" on whatever Monday
    // its standing 7am meeting last repeats, which is nonsense.
    const lastPhaseEnd = phases.reduce<string | null>((acc, ph) => {
      if (ph.event_type && NON_WORK_EVENTS.has(ph.event_type)) return acc;
      if (isClockInRow(ph)) return acc;
      const end = ph.end_date || ph.start_date;
      return !acc || end > acc ? end : acc;
    }, null);
    const closeDate = lastPhaseEnd ?? p.estimated_end_date ?? null;
    const closeSource: BoardJob["closeSource"] = lastPhaseEnd
      ? "schedule"
      : p.estimated_end_date
        ? "estimate"
        : null;
    const closeSlipDays =
      lastPhaseEnd && p.estimated_end_date
        ? daysBetween(p.estimated_end_date, lastPhaseEnd)
        : null;

    const startDate =
      p.actual_start_date ??
      phases.reduce<string | null>(
        (acc, ph) => (!acc || ph.start_date < acc ? ph.start_date : acc),
        null,
      ) ??
      p.estimated_start_date ??
      null;

    // ── Contract payments mapped onto the calendar ──
    const anchorPhases = phases.map((ph) => ({
      name: ph.name,
      end: ph.end_date || ph.start_date,
    }));
    const contractTotal = p.contract_value ?? p.estimated_value ?? 0;
    const payments: BoardPayment[] = (milestonesByProject.get(p.id) ?? []).map((m) => {
      const anchor = resolvePaymentDate(m.stage_key, m.label, anchorPhases);
      const date = anchor?.end ?? null;
      const dollars =
        m.amount !== null
          ? Number(m.amount)
          : m.percent !== null
            ? Math.round((Number(m.percent) / 100) * Number(contractTotal))
            : null;
      return {
        id: m.id,
        projectId: p.id,
        label: m.label,
        amount: canSeeMoney ? dollars : null,
        status: m.status,
        stageKey: m.stage_key,
        date,
        col: date ? (colOf.get(date) ?? null) : null,
        anchor: anchor?.name ?? null,
        requires: anchor?.requires ?? [],
      };
    });

    // ── Where the job stands: what's on now, what's next, what's late ──
    const live = phases.filter(
      (ph) => !isClockInRow(ph) && !(ph.event_type && NON_WORK_EVENTS.has(ph.event_type)),
    );
    // The job's own sequence speaks first; on a job run only by crew days
    // (no master schedule), the crew day IS what's on.
    const open = live.filter((ph) => ph.status !== "completed");
    const openPlan = open.filter((ph) => barKind(ph.event_type) === "plan");
    const pickNow = (rows: PhaseRow[]) =>
      rows
        .filter((ph) => ph.start_date <= todayStr && (ph.end_date || ph.start_date) >= todayStr)
        .sort((a, b) => (a.end_date || a.start_date).localeCompare(b.end_date || b.start_date))[0];
    const pickNext = (rows: PhaseRow[]) =>
      rows
        .filter((ph) => ph.start_date > todayStr)
        .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    const nowPhase = pickNow(openPlan) ?? pickNow(open);
    const nextPhase = pickNext(openPlan) ?? pickNext(open);
    const overdueCount = live.filter(
      (ph) =>
        ph.phase_scope === "master" &&
        ph.status !== "completed" &&
        (ph.end_date || ph.start_date) < todayStr,
    ).length;
    const nothingAhead = !live.some(
      (ph) => ph.status !== "completed" && (ph.end_date || ph.start_date) >= todayStr,
    );
    // A real shift: still open, or closed after it started. Photo-only posts
    // carry a zero-length duration and are not attendance.
    const workedDays = Array.from(
      new Set(
        logs
          .filter((l) => l.ended_at === null || new Date(l.ended_at) > new Date(l.started_at))
          .map((l) => easternDate(l.started_at))
          .filter((d) => d >= firstStr && d <= todayStr),
      ),
    );
    const laterSteps = openPlan
      .filter((ph) => ph.start_date > lastStr)
      .map((ph) => ({ id: ph.id, startDate: ph.start_date, endDate: ph.end_date || ph.start_date }));
    const spanStart = live.reduce<string | null>(
      (acc, ph) => (!acc || ph.start_date < acc ? ph.start_date : acc),
      null,
    );

    return {
      id: p.id,
      name: p.name,
      projectNumber: p.project_number,
      status: p.status,
      phase: p.phase,
      city: p.city,
      site,
      contractValue: canSeeMoney ? (p.contract_value ?? p.estimated_value ?? null) : null,
      closeDate,
      closeSource,
      closeSlipDays,
      startsInDays: startDate ? daysBetween(todayStr, startDate) : null,
      startDate,
      bars: mergedBars,
      markers,
      crewToday: Array.from(crewSeen.values()),
      lastLog: lastNarrative
        ? {
            text: lastNarrative.text!.slice(0, 220),
            at: lastNarrative.started_at,
            author: authorName.get(lastNarrative.author_id ?? "") || "Crew",
          }
        : null,
      daysSinceLastLog,
      openTodoCount: openTodos.get(p.id) ?? 0,
      unsignedCoCount: unsignedCos.get(p.id) ?? 0,
      payments,
      received: canSeeMoney ? Math.round(receivedByProject.get(p.id) ?? 0) : null,
      spent: canSeeMoney ? Math.round(spentByProject.get(p.id) ?? 0) : null,
      unscheduled: p.status === "in_progress" && mergedBars.length === 0,
      nowStep: nowPhase
        ? { name: nowPhase.name, endDate: nowPhase.end_date || nowPhase.start_date }
        : null,
      nextStep: nextPhase
        ? { name: nextPhase.name, startDate: nextPhase.start_date, confirmed: !!nextPhase.is_confirmed }
        : null,
      overdueCount,
      nothingAhead,
      workedDays,
      hiddenClockIns,
      spanStart,
      spanEnd: lastPhaseEnd,
      laterSteps,
    };
  }

  const jobs = projects.map(buildJob);

  const onsite = jobs
    .filter((j) => (ONSITE_STATUSES as readonly string[]).includes(j.status))
    // Crews on site first, then jobs with work scheduled, then the stragglers.
    .sort((a, b) => {
      const rank = (j: BoardJob) =>
        j.crewToday.length ? 0 : j.bars.length ? 1 : 2;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });

  const starting = jobs
    .filter((j) => (STARTING_STATUSES as readonly string[]).includes(j.status))
    // Soonest start first; jobs with no date at all sink to the bottom.
    .sort((a, b) => {
      if (a.startsInDays === null) return b.startsInDays === null ? 0 : 1;
      if (b.startsInDays === null) return -1;
      return a.startsInDays - b.startsInDays;
    });

  const pipeline = jobs
    .filter((j) => (PIPELINE_STATUSES as readonly string[]).includes(j.status))
    .sort((a, b) => (b.contractValue ?? 0) - (a.contractValue ?? 0) || a.name.localeCompare(b.name));

  // Money still to collect that actually lands inside the visible window.
  const dueInWindow = [...onsite, ...starting].reduce(
    (sum, j) =>
      sum +
      j.payments
        .filter((pay) => pay.col !== null && pay.status !== "paid")
        .reduce((n, pay) => n + (pay.amount ?? 0), 0),
    0,
  );

  return {
    days,
    todayStr,
    onsite,
    starting,
    pipeline,
    weather,
    hourly,
    defaultSite: siteKey(null),
    canSeeMoney,
    dueInWindow,
  };
}
