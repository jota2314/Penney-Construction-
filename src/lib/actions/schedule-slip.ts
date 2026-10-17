"use server";

import { slippedDates } from "@/lib/schedule/slip-dates";
import { crewToday } from "@/lib/crew/schedule-dates";
import { createClient } from "@/lib/supabase/server";
import { revalidateSchedule } from "@/lib/schedule/revalidate";
import { withEffectiveScheduleDates, type CascadeInput } from "@/lib/schedule/cascade";
import { isMasterPhase } from "@/lib/schedule/progress";
import {
  notifySchedulePhaseAssignees,
  formatShortRange,
} from "@/lib/notifications/schedule-notify";

/**
 * Push the project's schedule back by N days when work falls behind.
 *
 * Only shifts phases that haven't started yet (status='not_started')
 * AND any in_progress phase whose end_date is still in the future.
 * Completed phases stay put — they're already history.
 *
 * Only master phases move. Daily crew assignments stay on their assigned dates.
 * Started work retains its original start; completed/past work stays put.
 * The move starts from the dates the office sees, including the forecast,
 * then pins that decision without replacing the original plan.
 *
 * Shifting a CONFIRMED (live) phase emails everyone assigned to it — the
 * schedule they were told about just moved.
 */
export async function slipProjectSchedule(
  projectId: string,
  days: number
): Promise<{ shifted: number; notified?: number; error?: string }> {
  if (!Number.isInteger(days) || days <= 0) return { shifted: 0, error: "Days must be a positive number" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { shifted: 0, error: "Not authenticated" };

  // Completed anchors still participate in the forecast, but never move.
  const { data: phases, error: readErr } = await supabase
    .from("schedule_phases")
    .select("id, name, event_type, phase_scope, sort_order, start_date, end_date, planned_start_date, planned_end_date, status, is_confirmed, is_manually_scheduled, actual_completed_at")
    .eq("project_id", projectId)
    .or("phase_scope.eq.master,phase_scope.is.null");
  if (readErr) return { shifted: 0, error: readErr.message };
  if (!phases || phases.length === 0) return { shifted: 0 };

  const today = crewToday();

  let shifted = 0;
  let notified = 0;
  const failures: string[] = [];
  const effective = withEffectiveScheduleDates((phases as CascadeInput[]).filter(isMasterPhase));
  for (const p of effective) {
    if (!p.start_date || !p.end_date || !p.status) continue;
    const dates = slippedDates({ start_date: p.start_date, end_date: p.end_date, status: p.status }, days, today);
    if (!dates) continue;
    const newStart = dates.start_date;
    const newEnd = dates.end_date;
    const { error: upErr } = await supabase
      .from("schedule_phases")
      .update({ start_date: newStart, end_date: newEnd, is_manually_scheduled: true })
      .eq("id", p.id)
      .eq("project_id", projectId);
    if (upErr) { failures.push(p.name || p.id); continue; }
    shifted++;

    if (p.is_confirmed) {
      const result = await notifySchedulePhaseAssignees({
        phaseId: p.id,
        kind: "updated",
        actorId: user.id,
        changes: [
          `Schedule pushed back ${days} day${days === 1 ? "" : "s"}: ${formatShortRange(p.start_date, p.end_date)} → ${formatShortRange(newStart, newEnd)}`,
        ],
      });
      notified += result.emailed.length;
    }
  }

  revalidateSchedule(projectId);
  return { shifted, notified, ...(failures.length ? {
    error: `${shifted} phases moved; ${failures.length} could not be saved (${failures.slice(0, 3).join(", ")}). Refresh the schedule before retrying.`,
  } : {}) };
}
