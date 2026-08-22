import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/push/send";

/**
 * The weekly Monday 7:00 AM crew meeting at the shop.
 *
 * There is no shift-template or roster-schedule concept in this app — the only
 * "who works where today" primitive is a dated `schedule_phases` row carrying
 * `assigned_employee_ids`, which is exactly what Today's Work on /crew renders
 * as a one-tap Clock In card. So the meeting is just that: a phase row on the
 * Shop job, created every Monday morning by cron and assigned to the crew.
 * No new UI, no new table.
 *
 * Why it matters for job costing: before this, every guy had to remember to
 * clock into Shop and then switch. On 8/17 two of them didn't — Angel's whole
 * day and 3.7h of Tanner's O'Mealia framing sat on the Shop job until they were
 * corrected by hand.
 */

/** The Shop job that overhead/meeting hours book to. */
export const SHOP_PROJECT_NUMBER = "PC-2026-171";

/** Stamped on `schedule_phases.event_type` to mark an auto-created meeting. */
export const SHOP_MEETING_EVENT_TYPE = "shop_meeting";

const MEETING_PHASE_NAME = "Monday shop meeting — 7:00 AM";
const MEETING_DESCRIPTION =
  "Weekly crew meeting at the shop. Clock in here when you get there — " +
  "clocking into your first job of the day closes it automatically.";

/** Brand amber, so the meeting card reads differently from job phases. */
const MEETING_COLOR = "#D97706";

/**
 * Roster rule: an active employee, linked to an app profile, who actually
 * punches a clock (≥3 real shifts in the last 30 days). This resolves to the
 * six guys on the tools and leaves out office/supervisor staff who post updates
 * but never log shift hours — and it maintains itself, so a new hire is picked
 * up once he starts clocking and someone who leaves drops off.
 */
const ROSTER_MIN_SHIFTS = 3;
const ROSTER_WINDOW_DAYS = 30;

/**
 * A meeting shift normally ends when the worker clocks into his first job. If
 * he never does, the sweep caps it at 45 minutes from his own clock-in rather
 * than letting it run to the 12h backstop.
 */
const MEETING_CAP_MS = 45 * 60 * 1000;

/**
 * Grace before the sweep will touch an open meeting shift. Generous on purpose:
 * a long drive to the first job still hands off naturally well inside this.
 */
const MEETING_SWEEP_GRACE_MS = 2 * 60 * 60 * 1000;

const MEETING_CAP_TEXT =
  "Auto clocked out — shop meeting capped at 45 min because no job clock-in " +
  "followed it. Open Time Log to fix your hours if that's wrong.";

/** Monday, in the UTC-date convention `getTodayPhases` already uses. */
function isMonday(dateIso: string): boolean {
  return new Date(`${dateIso}T12:00:00Z`).getUTCDay() === 1;
}

export interface EnsureMeetingResult {
  skipped?: "not-monday" | "no-shop-project" | "no-roster";
  phaseId?: string;
  created?: boolean;
  crewCount?: number;
  date?: string;
}

/**
 * Create (or refresh) this Monday's shop-meeting phase. Idempotent: re-running
 * updates the assigned crew instead of creating a second card.
 *
 * Pass an admin client — this runs from cron with no user session.
 */
export async function ensureWeeklyShopMeeting(
  supabase: SupabaseClient,
  opts: { date?: string; force?: boolean } = {},
): Promise<EnsureMeetingResult> {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  if (!opts.force && !isMonday(date)) return { skipped: "not-monday", date };

  const { data: shop } = await supabase
    .from("projects")
    .select("id, created_by")
    .eq("project_number", SHOP_PROJECT_NUMBER)
    .maybeSingle();
  if (!shop) return { skipped: "no-shop-project", date };

  const crewIds = await getMeetingRoster(supabase);
  if (crewIds.length === 0) return { skipped: "no-roster", date };

  const { data: existing } = await supabase
    .from("schedule_phases")
    .select("id")
    .eq("project_id", shop.id)
    .eq("event_type", SHOP_MEETING_EVENT_TYPE)
    .eq("start_date", date)
    .maybeSingle();

  if (existing) {
    // Refresh the roster in case someone was hired or left mid-week.
    await supabase
      .from("schedule_phases")
      .update({ assigned_employee_ids: crewIds, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return { phaseId: existing.id, created: false, crewCount: crewIds.length, date };
  }

  const { data: inserted, error } = await supabase
    .from("schedule_phases")
    .insert({
      project_id: shop.id,
      name: MEETING_PHASE_NAME,
      description: MEETING_DESCRIPTION,
      start_date: date,
      end_date: date,
      status: "in_progress",
      phase_scope: "daily",
      event_type: SHOP_MEETING_EVENT_TYPE,
      assigned_employee_ids: crewIds,
      color: MEETING_COLOR,
      // Sorts above the day's job phases so it's the first card they see.
      sort_order: -100,
      // Today's Work only surfaces confirmed (or live) phases.
      is_confirmed: true,
      confirmed_at: new Date().toISOString(),
      created_by: shop.created_by,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return { phaseId: inserted.id, created: true, crewCount: crewIds.length, date };
}

/** Employee ids for the guys who should get the meeting card. */
async function getMeetingRoster(supabase: SupabaseClient): Promise<string[]> {
  const { data: employees } = await supabase
    .from("employees")
    .select("id, profile_id")
    .eq("status", "active")
    .not("profile_id", "is", null);
  if (!employees || employees.length === 0) return [];

  const since = new Date(Date.now() - ROSTER_WINDOW_DAYS * 86400000).toISOString();
  const { data: recent } = await supabase
    .from("daily_logs")
    .select("author_id, started_at, ended_at")
    .eq("status", "completed")
    .gt("started_at", since)
    .not("ended_at", "is", null);

  // Count real shifts only — a bare "post update" row has ended_at == started_at.
  const shiftsByProfile = new Map<string, number>();
  for (const log of recent ?? []) {
    if (!log.author_id) continue;
    if (new Date(log.ended_at as string) <= new Date(log.started_at as string)) continue;
    shiftsByProfile.set(log.author_id, (shiftsByProfile.get(log.author_id) ?? 0) + 1);
  }

  return employees
    .filter((e) => (shiftsByProfile.get(e.profile_id as string) ?? 0) >= ROSTER_MIN_SHIFTS)
    .map((e) => e.id);
}

/** Recent shop-meeting phase ids, for hand-off and sweep lookups. */
async function recentMeetingPhaseIds(supabase: SupabaseClient): Promise<Set<string>> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("schedule_phases")
    .select("id")
    .eq("event_type", SHOP_MEETING_EVENT_TYPE)
    .gte("start_date", since);
  return new Set((data ?? []).map((p) => p.id));
}

/**
 * Close an open shop-meeting shift so the worker can clock straight into his
 * first job. Returns false when the open log isn't a meeting shift, in which
 * case the caller keeps the normal "clock out first" behaviour.
 */
export async function handOffMeetingShift(
  supabase: SupabaseClient,
  openLog: { id: string; schedule_phase_id: string | null },
): Promise<boolean> {
  if (!openLog.schedule_phase_id) return false;
  const meetingPhases = await recentMeetingPhaseIds(supabase);
  if (!meetingPhases.has(openLog.schedule_phase_id)) return false;

  const { error } = await supabase
    .from("daily_logs")
    .update({
      ended_at: new Date().toISOString(),
      status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", openLog.id)
    .eq("status", "in_progress"); // guard against a concurrent manual clock-out

  return !error;
}

export interface MeetingSweepResult {
  closed: number;
  notified: number;
}

/**
 * Cap any meeting shift left open with no job clock-in behind it. Mirrors
 * `autoCloseStaleLogs`: caps against the shift's own start (not "now"), flags
 * `auto_clocked_out` so it shows as edited/auto on the payroll timesheet, and
 * tells the worker to correct it if the cap is wrong.
 */
export async function closeStaleMeetingShifts(
  supabase: SupabaseClient,
): Promise<MeetingSweepResult> {
  const meetingPhases = await recentMeetingPhaseIds(supabase);
  if (meetingPhases.size === 0) return { closed: 0, notified: 0 };

  const cutoffIso = new Date(Date.now() - MEETING_SWEEP_GRACE_MS).toISOString();
  const { data: open } = await supabase
    .from("daily_logs")
    .select("id, author_id, started_at, text")
    .eq("status", "in_progress")
    .in("schedule_phase_id", Array.from(meetingPhases))
    .lt("started_at", cutoffIso);

  let closed = 0;
  let notified = 0;

  for (const log of open ?? []) {
    const cappedEnd = new Date(new Date(log.started_at).getTime() + MEETING_CAP_MS).toISOString();
    const { error } = await supabase
      .from("daily_logs")
      .update({
        ended_at: cappedEnd,
        status: "completed",
        auto_clocked_out: true,
        text: log.text?.trim() ? log.text : MEETING_CAP_TEXT,
        updated_at: new Date().toISOString(),
      })
      .eq("id", log.id)
      .eq("status", "in_progress");
    if (error) continue;
    closed++;

    if (!log.author_id) continue;
    try {
      const delivered = await sendPushToUser(supabase, log.author_id, {
        title: "Shop meeting clocked out",
        body: "You never clocked into a job after the meeting, so it was capped at 45 min. Open Time Log to fix your hours if that's wrong.",
        url: "/crew/time-log",
        tag: `meeting-clockout-${log.id}`,
      });
      if (delivered > 0) notified++;
    } catch {
      // Push not configured / no devices — closing the log is what matters.
    }
  }

  return { closed, notified };
}
