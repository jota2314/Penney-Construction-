"use server";

import { createClient } from "@/lib/supabase/server";

export async function createEstimateFile(input: {
  estimate_id: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("estimate_files").insert({
    estimate_id: input.estimate_id,
    storage_path: input.storage_path,
    file_name: input.file_name,
    file_size: input.file_size,
    mime_type: input.mime_type,
    uploaded_by: user.id,
  });

  if (error) return { error: error.message };
  return { error: null };
}

export async function deleteEstimateFile(fileId: string, storagePath: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Delete from storage
  await supabase.storage.from("project-files").remove([storagePath]);

  // Delete metadata row
  const { error } = await supabase
    .from("estimate_files")
    .delete()
    .eq("id", fileId);

  if (error) return { error: error.message };
  return { error: null };
}
