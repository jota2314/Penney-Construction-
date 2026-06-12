"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_FILE_BUCKETS, isExternalUrl } from "@/lib/storage/project-file-url";
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

  // Get the storage path before deleting
  const { data: file } = await supabase
    .from("project_files")
    .select("storage_path")
    .eq("id", fileId)
    .single();

  // App uploads live in the project-files bucket. Agent-filed rows point
  // into email-attachments: standalone copies under uploads/ or proposals/
  // are safe to remove, but {gmailMessageId}/{filename} objects belong to
  // the email record (inbox_emails.attachments still references them) —
  // for those, delete the row only and leave the object.
  if (file?.storage_path && !isExternalUrl(file.storage_path)) {
    const path = file.storage_path;
    const { data: removed } = await supabase.storage.from("project-files").remove([path]);
    if ((!removed || removed.length === 0) && /^(uploads|proposals)\//.test(path)) {
      await supabase.storage.from("email-attachments").remove([path]);
    }
  }

  const { error } = await supabase.from("project_files").delete().eq("id", fileId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
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
  // Drawings/permits filed by the agent routines live in email-attachments,
  // app uploads in project-files — sign against both buckets and merge.
  for (const bucket of PROJECT_FILE_BUCKETS) {
    const missing = paths.filter((p) => !signed.has(p));
    if (missing.length === 0) break;
    const { data: urls } = await supabase.storage
      .from(bucket)
      .createSignedUrls(missing, 60 * 60);
    (urls ?? []).forEach((u) => {
      if (u.path && u.signedUrl && !u.error) signed.set(u.path, u.signedUrl);
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
