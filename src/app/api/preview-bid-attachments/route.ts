import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Returns list of attachment filenames that would be included in a bid email.
 * Lightweight check — doesn't download files.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { projectId } = await request.json();
  if (!projectId) return NextResponse.json({ files: [] });

  const files: string[] = [];
  const seen = new Set<string>();

  // 1. Check project_files
  const { data: projectFiles } = await supabase
    .from("project_files")
    .select("filename, category")
    .eq("project_id", projectId)
    .in("category", ["construction_drawings", "specs", "estimates"])
    .order("created_at", { ascending: false })
    .limit(5);

  for (const f of projectFiles || []) {
    if (!seen.has(f.filename.toLowerCase())) {
      files.push(f.filename);
      seen.add(f.filename.toLowerCase());
    }
  }

  // 2. Check email attachments (PDFs)
  if (files.length < 5) {
    const { data: emails } = await supabase
      .from("inbox_emails")
      .select("attachments")
      .eq("project_id", projectId)
      .not("attachments", "is", null)
      .order("date", { ascending: false })
      .limit(20);

    for (const email of emails || []) {
      const atts = email.attachments as { filename: string; storage_path?: string; mimeType?: string }[] | null;
      if (!atts) continue;
      for (const att of atts) {
        if (!att.storage_path) continue;
        const isPdf = att.mimeType === "application/pdf" || att.filename?.toLowerCase().endsWith(".pdf");
        if (!isPdf) continue;
        if (seen.has(att.filename.toLowerCase())) continue;
        files.push(att.filename);
        seen.add(att.filename.toLowerCase());
        if (files.length >= 5) break;
      }
      if (files.length >= 5) break;
    }
  }

  return NextResponse.json({ files });
}
