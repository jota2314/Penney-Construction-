"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { canViewJobBoard } from "@/lib/auth/role-access";
import { isMasterPhase } from "@/lib/schedule/progress";
import { revalidateSchedule } from "@/lib/schedule/revalidate";
import { isFirm, stabilizePhaseDates, withEffectiveScheduleDates } from "@/lib/schedule/cascade";
import { isCalendarDate } from "@/lib/schedule/date-patch";

const forecastColumns = "id,name,status,start_date,end_date,planned_start_date,planned_end_date,sort_order,is_confirmed,is_manually_scheduled,phase_scope,event_type,actual_completed_at,updated_at,client_completed_at";

async function reviewForecast(db: Awaited<ReturnType<typeof createClient>>, projectId: string, phaseId: string, status: string | null, endDate: string | null) {
  const { data, error } = await db.from("schedule_phases").select(forecastColumns).eq("project_id", projectId);
  if (error) throw new Error("Could not check the current forecast. Refresh and try again.");
  const phases = (data ?? []).filter(isMasterPhase);
  const phase = phases.find(p => p.id === phaseId);
  if (!phase) throw new Error("Choose a master phase from this project.");
  if (phase.event_type === "inspection" || isFirm(phase) || phase.is_manually_scheduled) return null;
  if (endDate) {
    const effective = withEffectiveScheduleDates(phases).find(p => p.id === phaseId)!;
    return effective.start_date && effective.end_date ? { start_date: effective.start_date, end_date: effective.end_date } : null;
  }
  return stabilizePhaseDates(phases, phaseId, { status });
}

async function officeClient() {
  const user = await getUser();
  if (!user || !canViewJobBoard({ role: user.profile?.role })) throw new Error("Office schedule access required.");
  return createClient();
}

export async function getScheduleReview(projectId: string, page = 0) {
  try {
    z.string().uuid().parse(projectId);
    z.number().int().min(0).max(10000).parse(page);
    const db = await officeClient();
    const [project, phases, logs] = await Promise.all([
      db.from("projects").select("id,status").eq("id", projectId).single(),
      db.from("schedule_phases").select(forecastColumns).eq("project_id", projectId).order("sort_order").order("id"),
      db.from("daily_logs").select("id,text,started_at,updated_at,report_progress,master_phase_id").eq("project_id", projectId)
        .not("text", "is", null).order("updated_at", { ascending: false }).order("id").range(page * 40, page * 40 + 39),
    ]);
    if (project.error || phases.error || logs.error) throw new Error(project.error?.message ?? phases.error?.message ?? logs.error?.message);
    const ids = (logs.data ?? []).map(log => log.id);
    const reviews = ids.length ? await db.from("schedule_progress_reviews").select("daily_log_id,evidence_updated_at,note,created_at,master_phase_id").in("daily_log_id", ids) : { data: [], error: null };
    if (reviews.error) throw new Error(reviews.error.message);
    return {
      data: {
        project: project.data!, phases: withEffectiveScheduleDates((phases.data ?? []).filter(isMasterPhase)),
        reports: (logs.data ?? []).map(log => ({ ...log, review: (reviews.data ?? []).find(review => review.daily_log_id === log.id && Date.parse(review.evidence_updated_at) === Date.parse(log.updated_at)) ?? null })),
        hasMore: logs.data?.length === 40,
      }, error: null,
    };
  } catch (error) { return { data: null, error: error instanceof Error ? error.message : "Could not load schedule review." }; }
}

const reviewSchema = z.object({
  projectId: z.string().uuid(), logId: z.string().uuid(), phaseId: z.string().uuid().nullable(),
  evidenceUpdatedAt: z.string().datetime({ offset: true }), phaseUpdatedAt: z.string().datetime({ offset: true }).nullable(),
  status: z.enum(["not_started", "in_progress", "completed", "on_hold"]).nullable(),
  endDate: z.string().refine(isCalendarDate, "Enter a valid finish date.").nullable(), note: z.string().trim().min(1).max(2000),
});
export async function reviewFieldProgress(input: z.infer<typeof reviewSchema>) {
  try {
    const v = reviewSchema.parse(input);
    const db = await officeClient();
    const { data: log, error: readError } = await db.from("daily_logs").select("project_id").eq("id", v.logId).single();
    if (readError || log?.project_id !== v.projectId) throw new Error("This report belongs to another project.");
    const forecast = v.phaseId ? await reviewForecast(db, v.projectId, v.phaseId, v.status, v.endDate) : null;
    const { error } = await db.rpc("review_schedule_field_progress", {
      p_log_id: v.logId, p_phase_id: v.phaseId, p_evidence_updated_at: v.evidenceUpdatedAt,
      p_phase_updated_at: v.phaseUpdatedAt, p_status: v.status, p_end_date: v.endDate, p_note: v.note,
      p_forecast_start: forecast?.start_date ?? null, p_forecast_end: forecast?.end_date ?? null,
    });
    if (error) throw new Error(error.message);
    revalidateSchedule(v.projectId);
    return { error: null };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not save review." }; }
}

export async function reconcileProjectSchedule(projectId: string, expectedStatus: string, nextStatus: "in_progress" | "completed") {
  try {
    z.string().uuid().parse(projectId);
    const db = await officeClient();
    const { error } = await db.rpc("reconcile_project_schedule", { p_project_id: projectId, p_expected_status: expectedStatus, p_next_status: nextStatus });
    if (error) throw new Error(error.message);
    revalidateSchedule(projectId);
    return { error: null };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not reconcile project." }; }
}

const clientReviewSchema = z.object({
  projectId: z.string().uuid(), phaseId: z.string().uuid(),
  phaseUpdatedAt: z.string().datetime({ offset: true }), clientCompletedAt: z.string().datetime({ offset: true }),
  note: z.string().trim().min(1).max(2000),
});
export async function verifyClientPhaseCompletion(input: z.infer<typeof clientReviewSchema>) {
  try {
    const v = clientReviewSchema.parse(input);
    const db = await officeClient();
    const { data: phase, error: readError } = await db.from("schedule_phases").select("project_id").eq("id", v.phaseId).single();
    if (readError || phase?.project_id !== v.projectId) throw new Error("This phase belongs to another project.");
    const forecast = await reviewForecast(db, v.projectId, v.phaseId, "completed", null);
    const { error } = await db.rpc("verify_client_schedule_progress", {
      p_phase_id: v.phaseId, p_phase_updated_at: v.phaseUpdatedAt, p_client_completed_at: v.clientCompletedAt, p_note: v.note,
      p_forecast_start: forecast?.start_date ?? null, p_forecast_end: forecast?.end_date ?? null,
    });
    if (error) throw new Error(error.message);
    revalidateSchedule(v.projectId);
    return { error: null };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not verify client report." }; }
}
