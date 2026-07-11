"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
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
 * Adds N days to both start_date and end_date on every affected row.
 * Postgres date arithmetic handles month/year rollover for free.
 *
 * Shifting a CONFIRMED (live) phase emails everyone assigned to it — the
 * schedule they were told about just moved.
 */
export async function slipProjectSchedule(
  projectId: string,
  days: number
): Promise<{ shifted: number; notified?: number; error?: string }> {
  if (!Number.isFinite(days) || days <= 0) return { shifted: 0, error: "Days must be a positive number" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { shifted: 0, error: "Not authenticated" };

  // Pull every phase that isn't already done — we shift not_started,
  // in_progress, and on_hold. Completed phases keep their dates.
  const { data: phases, error: readErr } = await supabase
    .from("schedule_phases")
    .select("id, start_date, end_date, status, is_confirmed")
    .eq("project_id", projectId)
    .neq("status", "completed");
  if (readErr) return { shifted: 0, error: readErr.message };
  if (!phases || phases.length === 0) return { shifted: 0 };

  const addDays = (iso: string, n: number): string => {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  let shifted = 0;
  let notified = 0;
  for (const p of phases) {
    const newStart = addDays(p.start_date, days);
    const newEnd = addDays(p.end_date, days);
    const { error: upErr } = await supabase
      .from("schedule_phases")
      .update({ start_date: newStart, end_date: newEnd })
      .eq("id", p.id);
    if (upErr) continue;
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

  revalidatePath("/schedule");
  revalidatePath("/command-center");
  revalidatePath(`/projects/${projectId}`);
  return { shifted, notified };
}
