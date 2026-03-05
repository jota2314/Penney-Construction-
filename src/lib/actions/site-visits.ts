"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SiteVisitType } from "@/types/database";

export async function createSiteVisit(input: {
  project_id?: string;
  estimate_id?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  purpose?: string;
  visit_type?: "pricing" | "progress" | "punch_list";
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { data, error } = await supabase
    .from("site_visits")
    .insert({
      project_id: input.project_id || null,
      estimate_id: input.estimate_id || null,
      name: input.name || null,
      address: input.address || null,
      city: input.city || null,
      state: input.state || null,
      zip: input.zip || null,
      purpose: input.purpose || null,
      visit_type: input.visit_type ?? "progress",
      status: "in_progress",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/site-visits");
  return { error: null, id: data.id };
}

export async function completeSiteVisit(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("site_visits")
    .update({
      status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/site-visits");
  revalidatePath(`/site-visits/${id}`);
  return { error: null };
}

export async function deleteSiteVisit(id: string, projectId?: string | null) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Clean up storage files first
  const { data: files } = await supabase
    .from("site_visit_files")
    .select("storage_path")
    .eq("site_visit_id", id);

  if (files && files.length > 0) {
    const paths = files.map((f) => f.storage_path);
    await supabase.storage.from("project-files").remove(paths);
  }

  // Delete the site visit (cascades to notes and files)
  const { error } = await supabase.from("site_visits").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/site-visits");
  return { error: null };
}

export async function saveSiteVisitSummary(id: string, summary: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("site_visits")
    .update({ summary })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/site-visits/${id}`);
  return { error: null };
}

export async function updateSiteVisitType(id: string, visitType: SiteVisitType) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("site_visits")
    .update({ visit_type: visitType })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/site-visits");
  revalidatePath(`/site-visits/${id}`);
  return { error: null };
}

export async function addSiteVisitNote(input: {
  site_visit_id: string;
  content: string;
  source: "typed" | "voice";
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Get next sort_order
  const { data: existing } = await supabase
    .from("site_visit_notes")
    .select("sort_order")
    .eq("site_visit_id", input.site_visit_id)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextSort =
    existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from("site_visit_notes")
    .insert({
      site_visit_id: input.site_visit_id,
      content: input.content,
      source: input.source,
      sort_order: nextSort,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) return { error: error.message };

  revalidatePath(`/site-visits/${input.site_visit_id}`);
  return { error: null, note: data };
}

export async function updateSiteVisitNote(noteId: string, content: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("site_visit_notes")
    .update({ content })
    .eq("id", noteId);

  if (error) return { error: error.message };

  return { error: null };
}

export async function deleteSiteVisitNote(
  noteId: string,
  siteVisitId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("site_visit_notes")
    .delete()
    .eq("id", noteId);

  if (error) return { error: error.message };

  revalidatePath(`/site-visits/${siteVisitId}`);
  return { error: null };
}
