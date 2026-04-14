import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listFolderFiles } from "@/lib/google/drive";

export const runtime = "nodejs";

/**
 * List files in a project's Google Drive folder (or a subfolder).
 * GET /api/drive-files?projectId=xxx&folderId=yyy (optional folderId for subfolder)
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const folderId = searchParams.get("folderId");

  if (!folderId && !projectId) {
    return NextResponse.json({ error: "projectId or folderId required" }, { status: 400 });
  }

  let targetFolderId = folderId;

  // If no folderId, look up the project's Drive folder
  if (!targetFolderId && projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("google_drive_folder_id")
      .eq("id", projectId)
      .single();

    targetFolderId = project?.google_drive_folder_id;
    if (!targetFolderId) {
      return NextResponse.json({ files: [], message: "No Google Drive folder linked to this project" });
    }
  }

  try {
    const files = await listFolderFiles(targetFolderId!);
    return NextResponse.json({ files, folderId: targetFolderId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to list files" }, { status: 500 });
  }
}
