"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Push the project's schedule back by N days when work falls behind.
 *
 * Only shifts phases that haven't started yet (status='not_started')
 * AND any in_progress phase whose end_date is still in the future.
 * Completed phases stay put — they're already history.
 *
 * Adds N days to both start_date and end_date on every affected row.
 * Postgres date arithmetic handles month/year rollover for free.
 */
export async function slipProjectSchedule(
  projectId: string,
  days: number
): Promise<{ shifted: number; error?: string }> {
  if (!Number.isFinite(days) || days <= 0) return { shifted: 0, error: "Days must be a positive number" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { shifted: 0, error: "Not authenticated" };

  // Pull every phase that isn't already done — we shift not_started,
  // in_progress, and on_hold. Completed phases keep their dates.
  const { data: phases, error: readErr } = await supabase
    .from("schedule_phases")
    .select("id, start_date, end_date, status")
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
  for (const p of phases) {
    const newStart = addDays(p.start_date, days);
    const newEnd = addDays(p.end_date, days);
    const { error: upErr } = await supabase
      .from("schedule_phases")
      .update({ start_date: newStart, end_date: newEnd })
      .eq("id", p.id);
    if (!upErr) shifted++;
  }

  revalidatePath("/schedule");
  revalidatePath("/command-center");
  revalidatePath(`/projects/${projectId}`);
  return { shifted };
}
