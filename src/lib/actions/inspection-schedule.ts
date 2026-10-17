"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canViewJobBoard } from "@/lib/auth/role-access";
import { revalidateSchedule } from "@/lib/schedule/revalidate";
import { isCalendarDate } from "@/lib/schedule/date-patch";
import type { ScheduleInspection, InspectionMilestone, InspectionHistory } from "@/lib/schedule/inspection-types";

async function officeClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to manage inspections.");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canViewJobBoard({ role: profile?.role })) throw new Error("Office schedule access is required.");
  return { supabase, user };
}
const fail = (error: unknown) => ({ error: error instanceof Error ? error.message : "Could not save the inspection." });
const uuid = z.string().uuid();
const date = z.string().refine(isCalendarDate, "Choose a valid date.");

export async function getInspectionSchedule(projectId: string): Promise<{
  inspections: ScheduleInspection[]; milestones: InspectionMilestone[]; history: InspectionHistory[]; error?: string;
}> {
  try {
    uuid.parse(projectId);
    const { supabase } = await officeClient();
    const [inspections, milestones, history] = await Promise.all([
      supabase.from("project_inspections").select("id,project_id,name,status,schedule_phase_id,scheduled_for,completed_at,notes,is_final,updated_at").eq("project_id", projectId).order("sort_order"),
      supabase.from("schedule_phases").select("id,name,status,start_date,end_date,actual_completed_at,updated_at").eq("project_id", projectId).or("phase_scope.eq.master,phase_scope.is.null").eq("event_type", "inspection").order("sort_order"),
      supabase.from("inspection_schedule_history").select("id,inspection_id,created_at,source,before_record,after_record").eq("project_id", projectId).order("created_at", { ascending: false }).limit(100),
    ]);
    for (const result of [inspections, milestones, history]) if (result.error) throw new Error(result.error.message);
    return { inspections: inspections.data ?? [], milestones: milestones.data ?? [], history: history.data ?? [] } as { inspections: ScheduleInspection[]; milestones: InspectionMilestone[]; history: InspectionHistory[] };
  } catch (error) { return { inspections: [], milestones: [], history: [], ...fail(error) }; }
}

export async function saveInspectionSchedule(input: {
  id: string; projectId: string; expectedUpdatedAt: string;
  status: "pending" | "passed" | "failed"; scheduledFor: string | null;
  completedAt: string | null; notes: string;
}) {
  try {
    const parsed = z.object({ id: uuid, projectId: uuid, expectedUpdatedAt: z.string().datetime({ offset: true }),
      status: z.enum(["pending", "passed", "failed"]), scheduledFor: date.nullable(),
      completedAt: z.string().datetime({ offset: true }).nullable(), notes: z.string().trim().max(4000),
    }).parse(input);
    const { supabase } = await officeClient();
    const { data: row, error: readError } = await supabase.from("project_inspections").select("id").eq("id", parsed.id).eq("project_id", parsed.projectId).single();
    if (readError || !row) throw new Error("Inspection not found on this project.");
    const { error } = await supabase.rpc("update_project_inspection_lifecycle", {
      p_inspection_id: parsed.id, p_expected_updated_at: parsed.expectedUpdatedAt, p_source: "office",
      p_patch: { status: parsed.status, scheduled_for: parsed.scheduledFor, completed_at: parsed.status === "pending" ? null : parsed.completedAt, notes: parsed.notes },
    });
    if (error) throw new Error(error.message);
    revalidateSchedule(parsed.projectId);
    return { error: null };
  } catch (error) { return fail(error); }
}

export async function linkInspectionSchedule(input: {
  id: string; projectId: string; phaseId: string | null; authority: "inspection" | "schedule"; expectedUpdatedAt: string; phaseExpectedUpdatedAt: string | null;
}) {
  try {
    const parsed = z.object({ id: uuid, projectId: uuid, phaseId: uuid.nullable(), authority: z.enum(["inspection", "schedule"]), expectedUpdatedAt: z.string().datetime({ offset: true }), phaseExpectedUpdatedAt: z.string().datetime({ offset: true }).nullable() }).parse(input);
    const { supabase } = await officeClient();
    const { data: row } = await supabase.from("project_inspections").select("id").eq("id", parsed.id).eq("project_id", parsed.projectId).single();
    if (!row) throw new Error("Inspection not found on this project.");
    const { error } = await supabase.rpc("link_project_inspection_schedule", { p_inspection_id: parsed.id, p_phase_id: parsed.phaseId, p_authority: parsed.authority, p_expected_updated_at: parsed.expectedUpdatedAt, p_phase_expected_updated_at: parsed.phaseExpectedUpdatedAt });
    if (error) throw new Error(error.message);
    revalidateSchedule(parsed.projectId);
    return { error: null };
  } catch (error) { return fail(error); }
}

export async function createInspectionMilestone(input: { id: string; projectId: string; date: string; expectedUpdatedAt: string }) {
  try {
    const parsed = z.object({ id: uuid, projectId: uuid, date, expectedUpdatedAt: z.string().datetime({ offset: true }) }).parse(input);
    const { supabase } = await officeClient();
    const { data: row } = await supabase.from("project_inspections").select("id").eq("id", parsed.id).eq("project_id", parsed.projectId).single();
    if (!row) throw new Error("Inspection not found on this project.");
    const { error } = await supabase.rpc("create_project_inspection_phase", { p_inspection_id: parsed.id, p_date: parsed.date, p_expected_updated_at: parsed.expectedUpdatedAt });
    if (error) throw new Error(error.message);
    revalidateSchedule(parsed.projectId);
    return { error: null };
  } catch (error) { return fail(error); }
}

export async function addScheduleInspection(projectId: string, name: string) {
  try {
    uuid.parse(projectId);
    const title = z.string().trim().min(1).max(120).parse(name);
    const { supabase, user } = await officeClient();
    const { error } = await supabase.from("project_inspections").insert({ project_id: projectId, name: title, created_by: user.id });
    if (error) throw new Error(error.message);
    revalidateSchedule(projectId);
    return { error: null };
  } catch (error) { return fail(error); }
}
