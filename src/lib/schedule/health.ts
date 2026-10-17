import { isMasterPhase, scheduleProgress } from "./progress";

export interface ScheduleHealthPhase {
  id?: string;
  name: string;
  phase_scope?: string | null;
  event_type?: string | null;
  status: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_confirmed?: boolean | null;
  planned_start_date?: string | null;
  estimate_line_item_id?: string | null;
}

export interface ScheduleHealthIssue {
  code: "missing_master" | "work_status" | "overdue" | "nothing_ahead" | "ready_to_close" | "completed_open_work";
  text: string;
  tone: "warning" | "urgent";
}

const NON_WORK_EVENTS = new Set(["meeting", "shop_meeting", "walkthrough"]);
const PRECON_STATUSES = new Set(["lead", "estimating", "waiting_for_approval", "proposal_sent", "contracted"]);
const CLOCK_IN_NAMES = new Set(["Needs allocation", "Change order work"]);

/** Attendance placeholders stay out of planning without hiding real daily steps. */
export function isClockInRow(ph: ScheduleHealthPhase): boolean {
  if (ph.event_type === "clock_in" || ph.event_type === "clockin" || /^clock[ -]?in\b/i.test(ph.name)) return true;
  if (ph.phase_scope !== "daily") return false;
  if (ph.event_type != null && ph.event_type !== "phase") return false;
  if (ph.status === "not_started" || ph.is_confirmed || ph.planned_start_date) return false;
  if ((ph.end_date || ph.start_date) !== ph.start_date) return false;
  return ph.status === "in_progress" || !!ph.estimate_line_item_id || CLOCK_IN_NAMES.has(ph.name);
}

function isWork(ph: ScheduleHealthPhase) {
  return !isClockInRow(ph) && !NON_WORK_EVENTS.has(ph.event_type ?? "");
}

function isOpen(ph: ScheduleHealthPhase) {
  return ph.status !== "completed" && ph.status !== "cancelled";
}

/** Same current/next activity on the board and Command Center; never a completed row. */
export function deriveCurrentScheduleActivity<T extends ScheduleHealthPhase>(phases: readonly T[], today: string, projectStatus?: string) {
  if (projectStatus === "completed" || projectStatus === "cancelled") return { current: null, next: null, upcoming: [] as T[] };
  const open = phases.filter((p) => isWork(p) && isOpen(p) && p.status !== "on_hold" && p.start_date);
  const master = open.filter(isMasterPhase);
  const nowRows = (rows: T[]) => rows
    .filter((p) => p.start_date! <= today && (p.end_date || p.start_date!) >= today)
    .sort((a, b) => Number(b.status === "in_progress") - Number(a.status === "in_progress") ||
      (a.end_date || a.start_date!).localeCompare(b.end_date || b.start_date!) || a.name.localeCompare(b.name));
  const nextRows = (rows: T[]) => rows
    .filter((p) => p.start_date! > today)
    .sort((a, b) => a.start_date!.localeCompare(b.start_date!) || a.name.localeCompare(b.name));
  const masterNow = nowRows(master), masterNext = nextRows(master);
  const current = masterNow.length ? masterNow : nowRows(open);
  const upcoming = masterNext.length ? masterNext : nextRows(open);
  return { current: current[0] ?? null, next: upcoming[0] ?? null, upcoming: [...current, ...upcoming] };
}

export interface ScheduleWorkLog {
  started_at: string;
  ended_at: string | null;
  status: string | null;
}

/** Positive time or a current shift is work evidence; zero-duration photo posts are not. */
export function recentWorkDates(logs: readonly ScheduleWorkLog[], today: string, now = Date.now()): string[] {
  const cutoff = new Date(`${today}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const dates = logs.flatMap((log) => {
    const start = Date.parse(log.started_at);
    if (!Number.isFinite(start) || start > now || !["in_progress", "completed"].includes(log.status ?? "")) return [];
    const positiveDuration = log.ended_at !== null && Date.parse(log.ended_at) > start;
    const activeShift = log.ended_at === null && log.status === "in_progress" && now - start < 24 * 3600_000;
    if (!positiveDuration && !activeShift) return [];
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(start));
    return date >= cutoffDate && date <= today ? [date] : [];
  });
  return [...new Set(dates)].sort();
}

/** Deterministic review signals. None of these changes dates, progress or project status. */
export function deriveScheduleHealth({ status, phases, today, recentWorkDates: worked = [] }: {
  status: string;
  phases: readonly ScheduleHealthPhase[];
  today: string;
  recentWorkDates?: readonly string[];
}) {
  const master = phases.filter((p) => isMasterPhase(p) && isWork(p) && p.status !== "cancelled");
  const open = master.filter(isOpen);
  const lastWorkDate = worked.length ? [...worked].sort().at(-1)! : null;
  const hasRecentWork = lastWorkDate !== null;
  const workStartedStatusMismatch = hasRecentWork && PRECON_STATUSES.has(status);
  const needsPlan = status === "in_progress" || status === "contracted" || hasRecentWork;
  const missingMaster = needsPlan && master.length === 0;
  const overduePhases = open.filter((p) => (p.end_date || p.start_date) && (p.end_date || p.start_date)! < today);
  const nothingAhead = needsPlan && open.length > 0 && !open.some((p) => (p.end_date || p.start_date || "") >= today);
  // Closeout uses the same full master denominator as the project and portal.
  const readyToClose = status === "in_progress" && scheduleProgress(phases).readyToClose;
  const completedOpenWork = status === "completed" && open.length > 0;
  const issues: ScheduleHealthIssue[] = [];
  if (workStartedStatusMismatch) issues.push({ code: "work_status", text: `Field work recorded ${lastWorkDate}; project status needs review`, tone: "urgent" });
  if (missingMaster) issues.push({ code: "missing_master", text: "Master schedule missing", tone: hasRecentWork || status === "in_progress" ? "urgent" : "warning" });
  if (completedOpenWork) issues.push({ code: "completed_open_work", text: `Project marked complete with ${open.length} unfinished master step${open.length === 1 ? "" : "s"}`, tone: "urgent" });
  if (overduePhases.length) issues.push({ code: "overdue", text: `${overduePhases.length} master step${overduePhases.length === 1 ? " is" : "s are"} past due`, tone: "warning" });
  if (nothingAhead) issues.push({ code: "nothing_ahead", text: "No remaining master work planned from today", tone: "urgent" });
  if (readyToClose) issues.push({ code: "ready_to_close", text: "All master work verified done; review project closeout", tone: "warning" });
  return { masterCount: master.length, missingMaster, workStartedStatusMismatch, lastWorkDate, overdueCount: overduePhases.length, overduePhases, nothingAhead, readyToClose, completedOpenWork, issues };
}

export function scheduleStartLabel(days: number): string {
  return days < 0 ? `Start date passed ${Math.abs(days)}d ago` : days === 0 ? "Starts today" : `Starts in ${days}d`;
}
