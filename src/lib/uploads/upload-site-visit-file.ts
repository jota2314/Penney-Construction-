import { createClient } from "@/lib/supabase/client";

interface UploadResult {
  storagePath: string | null;
  error: string | null;
}

export async function uploadSiteVisitFile(
  siteVisitId: string,
  file: File
): Promise<UploadResult> {
  const supabase = createClient();

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const uuid = crypto.randomUUID();
  const storagePath = `site-visits/${siteVisitId}/${uuid}.${ext}`;

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
