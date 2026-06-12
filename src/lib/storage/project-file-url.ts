/**
 * project_files.storage_path does not record which bucket the object lives
 * in: the app's Upload button writes to `project-files`, while the agent
 * routines (MCP `attach_to_project` / `extract_email_attachment`) write to
 * `email-attachments` — as of June 2026 most rows point there. A few legacy
 * rows even store an external URL (Drive/SharePoint link) as the path.
 *
 * Resolve a project_files path to an openable URL by trying both buckets,
 * mirroring what the MCP `show_file` tool and the AI tool handlers already
 * do. Works with both the browser and server Supabase clients.
 */

export const PROJECT_FILE_BUCKETS = ["project-files", "email-attachments"] as const;

interface StorageSigner {
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number
      ): Promise<{ data: { signedUrl: string } | null }>;
    };
  };
}

export function isExternalUrl(storagePath: string): boolean {
  return /^https?:\/\//i.test(storagePath);
}

export async function signProjectFilePath(
  supabase: StorageSigner,
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  if (isExternalUrl(storagePath)) return storagePath;
  for (const bucket of PROJECT_FILE_BUCKETS) {
    const { data } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, expiresInSeconds);
    if (data?.signedUrl) return data.signedUrl;
  }
  return null;
}
