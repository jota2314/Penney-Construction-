"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createWalkthroughFile(input: {
  walkthrough_id: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  caption?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { data, error } = await supabase
    .from("walkthrough_files")
    .insert({
      walkthrough_id: input.walkthrough_id,
      storage_path: input.storage_path,
      file_name: input.file_name,
      file_size: input.file_size,
      mime_type: input.mime_type,
      caption: input.caption || null,
      uploaded_by: user.id,
    })
    .select("*")
    .single();

  if (error) return { error: error.message };

  revalidatePath(`/walkthroughs/${input.walkthrough_id}`);
  return { error: null, file: data };
}

export async function deleteWalkthroughFile(
  fileId: string,
  storagePath: string,
  walkthroughId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  await supabase.storage.from("project-files").remove([storagePath]);

  const { error } = await supabase
    .from("walkthrough_files")
    .delete()
    .eq("id", fileId);

  if (error) return { error: error.message };

  revalidatePath(`/walkthroughs/${walkthroughId}`);
  return { error: null };
}
