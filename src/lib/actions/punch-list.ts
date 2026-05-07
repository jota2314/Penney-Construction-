"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Todo } from "@/types/database";

export async function getProjectPunchList(projectId: string): Promise<Todo[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("todos")
    .select("*")
    .eq("project_id", projectId)
    .eq("category", "punch_list")
    .order("status", { ascending: true })
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as Todo[];
}

export async function createPunchListItem(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const projectId = formData.get("project_id") as string;
  const projectName = formData.get("project_name") as string | null;
  const description = formData.get("description") as string;
  const assignee = (formData.get("assignee") as string) || null;
  const priority = (formData.get("priority") as string) || "medium";
  const dueDate = (formData.get("due_date") as string) || null;
  const location = (formData.get("location") as string) || null;
  // Photo paths come in as a comma-separated list of storage paths the
  // client already uploaded to the project-files bucket. Treat empty
  // string as no photos.
  const photoPathsRaw = (formData.get("creation_photo_paths") as string) || "";
  const creationPhotoPaths = photoPathsRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (!projectId || !description?.trim()) {
    throw new Error("Project and description are required");
  }

  // Prefix the location (room/area) into the description so it's
  // visible everywhere todos are listed without needing a new column.
  const fullDescription = location
    ? `[${location}] ${description.trim()}`
    : description.trim();

  // contact_name is NOT NULL on the legacy todos schema. For punch
  // list items it's really just a label — use the assignee, or the
  // project name as a fallback so the row inserts cleanly.
  const contactName = assignee || projectName || "Field crew";

  const { error } = await supabase.from("todos").insert({
    project_id: projectId,
    project_name: projectName,
    contact_name: contactName,
    contact_type: "internal",
    description: fullDescription,
    priority,
    category: "punch_list",
    due_date: dueDate,
    assignee,
    source: "manual",
    creation_photo_paths: creationPhotoPaths,
    created_by: user.id,
  });

  if (error) throw error;
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/crew");
}

/**
 * Bulk-create punch-list items in one shot. Used by the voice composer
 * so dictating "kitchen window doesn't latch, paint touch-up master
 * bath, caulk gap behind fridge" creates three rows at once instead of
 * forcing the user to fill out three forms.
 */
export async function createPunchListItems(
  projectId: string,
  projectName: string | null,
  items: Array<{ description: string; location: string | null; priority: string; assignee?: string | null }>
): Promise<{ inserted: number; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { inserted: 0, error: "Not authenticated" };
  if (items.length === 0) return { inserted: 0 };

  const rows = items.map((item) => {
    const fullDescription = item.location ? `[${item.location}] ${item.description}` : item.description;
    const priority = ["low", "medium", "high"].includes(item.priority) ? item.priority : "medium";
    const assignee = item.assignee?.trim() || null;
    return {
      project_id: projectId,
      project_name: projectName,
      contact_name: assignee || projectName || "Field crew",
      contact_type: "internal" as const,
      description: fullDescription,
      priority,
      category: "punch_list" as const,
      source: "manual" as const,
      assignee,
      created_by: user.id,
    };
  });

  const { error, data } = await supabase.from("todos").insert(rows).select("id");
  if (error) return { inserted: 0, error: error.message };
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/crew");
  return { inserted: data?.length ?? 0 };
}

export async function deletePunchListItem(id: string, projectId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("todos").delete().eq("id", id);
  if (error) throw error;
  revalidatePath(`/projects/${projectId}`);
}

export async function getPunchListPhotoUrl(storagePath: string) {
  const supabase = await createClient();
  const { data } = await supabase.storage
    .from("project-files")
    .createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? null;
}

/**
 * Mark a punch-list item done from the feed. Optionally attach a
 * completion photo at the same time. Used by the "Mark done" button on
 * the punch-list feed post card.
 */
export async function markPunchItemDone(
  itemId: string,
  projectId: string,
  completionPhotoPath: string | null
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const update: Record<string, unknown> = {
    status: "done",
    completed_at: new Date().toISOString(),
  };
  if (completionPhotoPath) update.completion_photo_path = completionPhotoPath;

  const { error } = await supabase
    .from("todos")
    .update(update)
    .eq("id", itemId)
    .eq("category", "punch_list");

  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/command-center");
  revalidatePath("/crew");
  return { ok: true };
}

/** Batch version — one round-trip for an item's full set of creation photos. */
export async function getPunchListPhotoUrls(storagePaths: string[]): Promise<string[]> {
  if (storagePaths.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase.storage
    .from("project-files")
    .createSignedUrls(storagePaths, 3600);
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u);
}
