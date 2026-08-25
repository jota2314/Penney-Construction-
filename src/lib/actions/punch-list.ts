"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import { canManageFeed } from "@/lib/auth/feed-permissions";
import { signThumbUrls } from "@/lib/image/transform-signed-url";
import { cachedSignedUrls } from "@/lib/storage/signed-url-cache";
import { revalidatePath } from "next/cache";
import type { Todo } from "@/types/database";

/**
 * Delete a whole punch-list group (managers only — Jorge + Ryan). A group is
 * either a shared punch_session_id or a single ad-hoc row (session id
 * `solo-<todoId>`). Admin client, after an explicit permission check.
 */
export async function deletePunchGroup(
  sessionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!sessionId) return { ok: false, error: "Invalid punch list." };

  const user = await getUser();
  if (!canManageFeed(user?.email)) {
    return { ok: false, error: "You don't have permission to delete this." };
  }

  const admin = createAdminClient();
  const query = admin.from("todos").delete();
  const { error } = sessionId.startsWith("solo-")
    ? await query.eq("id", sessionId.slice("solo-".length))
    : await query.eq("punch_session_id", sessionId);

  if (error) {
    console.error("Failed to delete punch group", {
      sessionId,
      error: error.message,
    });
    return { ok: false, error: "Could not delete the punch list. Try again." };
  }

  revalidatePath("/command-center");
  revalidatePath("/crew");
  return { ok: true };
}

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
  items: Array<{
    description: string;
    location: string | null;
    priority: string;
    assignee?: string | null;
    creation_photo_paths?: string[];
  }>
): Promise<{ inserted: number; sessionId?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { inserted: 0, error: "Not authenticated" };
  if (items.length === 0) return { inserted: 0 };

  // Stamp every row in this batch with one session id so the field
  // feed can render them as a single grouped checklist post.
  const sessionId = crypto.randomUUID();

  const rows = items.map((item) => {
    const fullDescription = item.location ? `[${item.location}] ${item.description}` : item.description;
    const priority = ["low", "medium", "high", "urgent"].includes(item.priority) ? item.priority : "medium";
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
      punch_session_id: sessionId,
      creation_photo_paths: item.creation_photo_paths ?? [],
      created_by: user.id,
    };
  });

  const { error, data } = await supabase.from("todos").insert(rows).select("id");
  if (error) {
    console.error("[createPunchListItems] insert failed:", error);
    return { inserted: 0, error: error.message };
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/command-center");
  revalidatePath("/crew");
  return { inserted: data?.length ?? 0, sessionId };
}

/**
 * Update a punch-list item's text. Used for inline edit on the grouped
 * checklist post. The leading [Room] prefix is preserved so the
 * location chip in the UI keeps working.
 */
export async function updatePunchItemText(
  itemId: string,
  newDescription: string
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const trimmed = newDescription.trim();
  if (!trimmed) return { error: "Description cannot be empty" };

  // Preserve the [Room] prefix if there was one originally.
  const { data: existing } = await supabase
    .from("todos")
    .select("description, project_id")
    .eq("id", itemId)
    .eq("category", "punch_list")
    .maybeSingle();
  if (!existing) return { error: "Item not found" };
  const m = /^(\[[^\]]+\])\s*/.exec(existing.description ?? "");
  const finalDescription = m ? `${m[1]} ${trimmed}` : trimmed;

  const { error } = await supabase
    .from("todos")
    .update({ description: finalDescription })
    .eq("id", itemId)
    .eq("category", "punch_list");
  if (error) return { error: error.message };

  revalidatePath(`/projects/${existing.project_id}`);
  revalidatePath("/command-center");
  return { ok: true };
}

/**
 * Assign (or unassign) a worker to a punch-list item after the fact.
 * Used by the inline assignee picker on grouped checklist posts so
 * the user doesn't have to delete + redo the whole list to fix a
 * forgotten assignee. Pass null to clear.
 */
export async function updatePunchItemAssignee(
  itemId: string,
  assignee: string | null
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: existing } = await supabase
    .from("todos")
    .select("project_id")
    .eq("id", itemId)
    .eq("category", "punch_list")
    .maybeSingle();
  if (!existing) return { error: "Item not found" };

  const { error } = await supabase
    .from("todos")
    .update({ assignee: assignee?.trim() || null })
    .eq("id", itemId)
    .eq("category", "punch_list");
  if (error) return { error: error.message };

  revalidatePath(`/projects/${existing.project_id}`);
  revalidatePath("/command-center");
  revalidatePath("/crew");
  return { ok: true };
}

/**
 * Reassign every item in a punch-list session (the whole grouped
 * checklist post) in one shot. Used when the original assignee falls
 * behind and the work needs to move to someone else.
 *
 * mode 'open':  only items still open get reassigned. Items already
 *               marked done stay tied to whoever finished them, so
 *               credit for completed work isn't lost.
 * mode 'all':   every item gets reassigned, including done ones. Use
 *               when the whole list is moving lock-stock to a new
 *               person.
 *
 * Pass null assignee to clear assignments.
 */
export async function reassignPunchSession(
  sessionId: string,
  assignee: string | null,
  mode: "open" | "all" = "open"
): Promise<{ updated: number; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { updated: 0, error: "Not authenticated" };

  let q = supabase
    .from("todos")
    .update({ assignee: assignee?.trim() || null })
    .eq("punch_session_id", sessionId)
    .eq("category", "punch_list");
  if (mode === "open") q = q.eq("status", "open");
  const { error, data } = await q.select("id, project_id");
  if (error) return { updated: 0, error: error.message };

  const projectId = data?.[0]?.project_id;
  if (projectId) revalidatePath(`/projects/${projectId}`);
  revalidatePath("/command-center");
  revalidatePath("/crew");
  return { updated: data?.length ?? 0 };
}

/**
 * Active employees for the assignee picker. Returned as a flat list of
 * { id, first_name, last_name, title } sorted by name.
 */
export async function listActiveEmployees(): Promise<
  Array<{ id: string; first_name: string; last_name: string; title: string | null }>
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("employees")
    .select("id, first_name, last_name, title")
    .eq("status", "active")
    .order("first_name", { ascending: true });
  return data ?? [];
}

/**
 * Toggle a punch-list item's done state without requiring a completion
 * photo. Used for the simple checkbox on grouped checklist posts.
 */
export async function togglePunchItemDone(
  itemId: string,
  done: boolean
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: existing } = await supabase
    .from("todos")
    .select("project_id")
    .eq("id", itemId)
    .eq("category", "punch_list")
    .maybeSingle();
  if (!existing) return { error: "Item not found" };

  const update: Record<string, unknown> = done
    ? { status: "done", completed_at: new Date().toISOString() }
    : { status: "open", completed_at: null };

  const { error } = await supabase
    .from("todos")
    .update(update)
    .eq("id", itemId)
    .eq("category", "punch_list");
  if (error) return { error: error.message };

  revalidatePath(`/projects/${existing.project_id}`);
  revalidatePath("/command-center");
  revalidatePath("/crew");
  return { ok: true };
}

export async function deletePunchListItem(id: string, projectId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("todos").delete().eq("id", id);
  if (error) throw error;
  revalidatePath(`/projects/${projectId}`);
}

export async function getPunchListPhotoUrl(storagePath: string) {
  const supabase = await createClient();
  const ttl = 60 * 60 * 24 * 7;
  const thumbs = await signThumbUrls(supabase, "project-files", [storagePath], ttl);
  const thumb = thumbs.get(storagePath);
  if (thumb) return thumb;
  // Thumbnail couldn't be signed — fall back to the full-size original.
  const { data } = await supabase.storage
    .from("project-files")
    .createSignedUrl(storagePath, ttl);
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
  const ttl = 60 * 60 * 24 * 7;
  const [{ data }, thumbs] = await Promise.all([
    cachedSignedUrls(supabase, "project-files", storagePaths, ttl),
    signThumbUrls(supabase, "project-files", storagePaths, ttl),
  ]);
  const fullByPath = new Map<string, string>();
  for (const d of data ?? []) {
    if (d.path && d.signedUrl) fullByPath.set(d.path, d.signedUrl);
  }
  // Thumbnail per path, falling back to the full-size original.
  return storagePaths
    .map((p) => thumbs.get(p) ?? fullByPath.get(p))
    .filter((u): u is string => !!u);
}
