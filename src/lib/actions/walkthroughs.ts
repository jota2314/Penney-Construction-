"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createWalkthrough(input: {
  name: string;
  estimate_id?: string;
  project_id?: string;
  meeting_id?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  purpose?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { data, error } = await supabase
    .from("walkthroughs")
    .insert({
      name: input.name,
      estimate_id: input.estimate_id || null,
      project_id: input.project_id || null,
      meeting_id: input.meeting_id || null,
      address: input.address || null,
      city: input.city || null,
      state: input.state || null,
      zip: input.zip || null,
      purpose: input.purpose || null,
      status: "in_progress",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/walkthroughs");
  return { error: null, id: data.id };
}

export async function completeWalkthrough(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("walkthroughs")
    .update({
      status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/walkthroughs");
  revalidatePath(`/walkthroughs/${id}`);
  return { error: null };
}

export async function deleteWalkthrough(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Clean up storage files first
  const { data: files } = await supabase
    .from("walkthrough_files")
    .select("storage_path")
    .eq("walkthrough_id", id);

  if (files && files.length > 0) {
    const paths = files.map((f) => f.storage_path);
    await supabase.storage.from("project-files").remove(paths);
  }

  const { error } = await supabase.from("walkthroughs").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/walkthroughs");
  return { error: null };
}

export async function saveWalkthroughSummary(id: string, summary: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("walkthroughs")
    .update({ summary })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/walkthroughs/${id}`);
  return { error: null };
}

export async function addWalkthroughNote(input: {
  walkthrough_id: string;
  content: string;
  source: "typed" | "voice";
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { data: existing } = await supabase
    .from("walkthrough_notes")
    .select("sort_order")
    .eq("walkthrough_id", input.walkthrough_id)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextSort =
    existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from("walkthrough_notes")
    .insert({
      walkthrough_id: input.walkthrough_id,
      content: input.content,
      source: input.source,
      sort_order: nextSort,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) return { error: error.message };

  revalidatePath(`/walkthroughs/${input.walkthrough_id}`);
  return { error: null, note: data };
}

export async function updateWalkthroughNote(noteId: string, content: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("walkthrough_notes")
    .update({ content })
    .eq("id", noteId);

  if (error) return { error: error.message };

  return { error: null };
}

export async function deleteWalkthroughNote(
  noteId: string,
  walkthroughId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("walkthrough_notes")
    .delete()
    .eq("id", noteId);

  if (error) return { error: error.message };

  revalidatePath(`/walkthroughs/${walkthroughId}`);
  return { error: null };
}
