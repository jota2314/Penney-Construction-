"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Get todos assigned to a specific employee for a project.
 * Matches by assignee name (first name or full name).
 */
export async function getCrewTasks(projectId: string, employeeName: string) {
  const supabase = await createClient();

  // Match todos assigned to this worker by name
  const firstName = employeeName.split(" ")[0];

  const { data, error } = await supabase
    .from("todos")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "open")
    .or(`assignee.ilike.%${firstName}%,assignee.ilike.%${employeeName}%`)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return [];
  return data ?? [];
}

/**
 * Get ALL open todos for a project (for crew to see what needs doing).
 */
export async function getProjectCrewTasks(projectId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("todos")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "open")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return [];
  return data ?? [];
}

/**
 * Complete a todo with an optional photo.
 */
export async function completeCrewTask(
  todoId: string,
  completionNote?: string,
  photoStoragePath?: string
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Get employee name
  const { data: employee } = await supabase
    .from("employees")
    .select("first_name, last_name")
    .eq("profile_id", user.id)
    .single();

  const completedBy = employee
    ? `${employee.first_name} ${employee.last_name}`
    : "Field crew";

  const updates: Record<string, unknown> = {
    status: "done",
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completion_note: completionNote ?? null,
    completion_photo_path: photoStoragePath ?? null,
    // Keep ai_summary as a one-line audit trail too — readable in the
    // office todos list without joining to the photo storage path.
    ai_summary: [
      `Completed by ${completedBy}`,
      completionNote ? `Note: ${completionNote}` : null,
      photoStoragePath ? `Photo attached` : null,
    ]
      .filter(Boolean)
      .join(" | "),
  };

  const { error } = await supabase
    .from("todos")
    .update(updates)
    .eq("id", todoId);

  if (error) return { error: error.message };
  revalidatePath("/crew");
  revalidatePath(`/projects`);
  return { error: null };
}
