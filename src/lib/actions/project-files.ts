"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ProjectFileCategory } from "@/types/database";

export async function getProjectFiles(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_files")
    .select("*")
    .eq("project_id", projectId)
    .order("category")
    .order("created_at", { ascending: false });

  if (error) return [];
  return data ?? [];
}

export async function uploadProjectFile(
  projectId: string,
  formData: FormData
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const file = formData.get("file") as File;
  const category = (formData.get("category") as ProjectFileCategory) || "other";
  const description = (formData.get("description") as string) || null;

  if (!file || file.size === 0) return { error: "No file provided" };

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${projectId}/${category}/${Date.now()}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("project-files")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) return { error: uploadError.message };

  const { error: dbError } = await supabase.from("project_files").insert({
    project_id: projectId,
    filename: file.name,
    storage_path: path,
    storage_bucket: "project-files",
    mime_type: file.type,
    size: file.size,
    category,
    description,
    uploaded_by: user.id,
  });

  if (dbError) return { error: dbError.message };
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function deleteProjectFile(fileId: string, projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Get the storage path + bucket before deleting.
  const { data: file } = await supabase
    .from("project_files")
    .select("storage_path, storage_bucket")
    .eq("id", fileId)
    .single();

  // Only remove the underlying object when it's a genuine upload we own
  // (`project-files`). Rows that point into `email-attachments` are shared with
  // the email record — delete the project_files pointer but leave the email's
  // copy intact.
  if (file?.storage_path && file.storage_bucket !== "email-attachments") {
    await supabase.storage
      .from(file.storage_bucket ?? "project-files")
      .remove([file.storage_path]);
  }

  const { error } = await supabase.from("project_files").delete().eq("id", fileId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

/**
 * "Remove from project" for an email-sourced attachment. Non-destructive: it
 * records a hide so the file stops showing on the Files tab, but the email and
 * its stored copy are untouched. `fileKey` is the stable identity the tab uses
 * (storage_path, or `${emailId}:${filename}` when there's no path).
 */
export async function dismissProjectFile(projectId: string, fileKey: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("project_dismissed_files")
    .upsert(
      { project_id: projectId, file_key: fileKey, dismissed_by: user.id },
      { onConflict: "project_id,file_key" },
    );
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

/** Undo a "remove from project" — bring a hidden email attachment back. */
export async function restoreProjectFile(projectId: string, fileKey: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("project_dismissed_files")
    .delete()
    .eq("project_id", projectId)
    .eq("file_key", fileKey);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

/** File keys the user has hidden from a project's Files tab. */
export async function getDismissedFileKeys(projectId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_dismissed_files")
    .select("file_key")
    .eq("project_id", projectId);
  return (data ?? []).map((r) => r.file_key as string);
}

export type CrewDoc = {
  id: string;
  filename: string;
  category: string;
  mime_type: string | null;
  url: string | null;
};

// Document categories a field worker should see on the job — plans, drawings,
// permits, specs. Office/financial categories (pricing, invoices, estimates)
// are intentionally excluded.
const CREW_DOC_CATEGORIES = ["construction_drawings", "plans", "permits", "specs", "other"];

/**
 * Field-relevant documents for a job, with short-lived signed URLs so the crew
 * can open drawings/permits straight from the crew app (private bucket).
 */
export async function getCrewJobDocuments(projectId: string): Promise<CrewDoc[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("project_files")
    .select("id, filename, category, mime_type, storage_path, created_at")
    .eq("project_id", projectId)
    .in("category", CREW_DOC_CATEGORIES)
    .order("created_at", { ascending: false });

  if (!data || data.length === 0) return [];

  const paths = data.map((f) => f.storage_path).filter((p): p is string => !!p);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage
      .from("project-files")
      .createSignedUrls(paths, 60 * 60);
    (urls ?? []).forEach((u) => {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    });
  }

  return data.map((f) => ({
    id: f.id,
    filename: f.filename,
    category: f.category,
    mime_type: f.mime_type,
    url: f.storage_path ? signed.get(f.storage_path) ?? null : null,
  }));
}
