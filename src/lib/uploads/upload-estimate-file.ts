import { createClient } from "@/lib/supabase/client";

interface UploadResult {
  storagePath: string | null;
  error: string | null;
}

export async function uploadEstimateFile(
  estimateId: string,
  file: File,
  projectId?: string
): Promise<UploadResult> {
  const supabase = createClient();

  // Generate unique path
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const uuid = crypto.randomUUID();
  const prefix = projectId || `leads/${estimateId}`;
  const storagePath = `${prefix}/${estimateId}/${uuid}.${ext}`;

  const { error } = await supabase.storage
    .from("project-files")
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    return { storagePath: null, error: error.message };
  }

  return { storagePath, error: null };
}
