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

  if (file?.storage_path) {
    await supabase.storage.from("project-files").remove([file.storage_path]);
  }

  const { error } = await supabase.from("project_files").delete().eq("id", fileId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}
