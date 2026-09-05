"use server";

import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { groupPendingReports, type PendingDailyReport } from "@/lib/crew/pending-reports";

export async function getMyPendingDailyReports(projectId?: string): Promise<PendingDailyReport[]> {
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) throw new Error("Sign in to see daily logs due.");
  const db = await createClient();
  let query = db.from("daily_logs")
    .select("id,project_id,started_at,ended_at,status,report_required,report_submitted_at")
    .eq("author_id", userId).eq("report_required", true).is("report_submitted_at", null)
    .eq("status", "completed").order("started_at");
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) throw new Error("Daily logs could not be checked. Please try again.");
  const ids = [...new Set((data ?? []).map(r => r.project_id).filter((id): id is string => !!id))];
  const { data: projects } = ids.length ? await db.from("projects").select("id,name").in("id", ids) : { data: [] };
  return groupPendingReports(data ?? [], new Map((projects ?? []).map(p => [p.id,p.name])));
}

export async function dailyReportClockInError(): Promise<string | null> {
  try {
    const overdue = (await getMyPendingDailyReports()).find(r => r.overdue);
    return overdue ? `Finish your daily log for ${overdue.projectName} (${overdue.workDate}) before clocking in. Open Daily logs due on your crew home.` : null;
  } catch (error) {
    return error instanceof Error ? error.message : "Daily logs could not be checked. Please try again.";
  }
}
