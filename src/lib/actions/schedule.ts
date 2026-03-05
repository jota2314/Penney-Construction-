"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

interface SchedulePhaseInput {
  project_id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  status?: string;
  sort_order?: number;
  assigned_employee_ids?: string[];
  assigned_sub_ids?: string[];
  color?: string;
  notes?: string;
}

export async function createSchedulePhase(input: SchedulePhaseInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("schedule_phases").insert({
    project_id: input.project_id,
    name: input.name,
    description: input.description || null,
    start_date: input.start_date,
    end_date: input.end_date,
    status: input.status || "not_started",
    sort_order: input.sort_order ?? 0,
    assigned_employee_ids: input.assigned_employee_ids ?? [],
    assigned_sub_ids: input.assigned_sub_ids ?? [],
    color: input.color || "#3b82f6",
    notes: input.notes || null,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${input.project_id}`);
  revalidatePath("/schedule");
  return { error: null };
}

export async function updateSchedulePhase(
  id: string,
  input: SchedulePhaseInput
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("schedule_phases")
    .update({
      name: input.name,
      description: input.description || null,
      start_date: input.start_date,
      end_date: input.end_date,
      status: input.status || "not_started",
      sort_order: input.sort_order ?? 0,
      assigned_employee_ids: input.assigned_employee_ids ?? [],
      assigned_sub_ids: input.assigned_sub_ids ?? [],
      color: input.color || "#3b82f6",
      notes: input.notes || null,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${input.project_id}`);
  revalidatePath("/schedule");
  return { error: null };
}

export async function deleteSchedulePhase(id: string, projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("schedule_phases")
    .delete()
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/schedule");
  return { error: null };
}
