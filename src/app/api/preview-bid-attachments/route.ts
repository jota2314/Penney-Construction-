import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export interface BidAttachmentFile {
  filename: string;
  storage_path: string;
  bucket: "project-files" | "email-attachments";
  category?: string;
  selected: boolean;
}

/**
 * Returns list of attachment files that could be included in a bid email.
 * Each file has storage info + a `selected` default (true for drawings/specs).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { projectId } = await request.json();
  if (!projectId) return NextResponse.json({ files: [] });

  const files: BidAttachmentFile[] = [];
  const seen = new Set<string>();

  // 1. Project files (drawings, specs, estimates, permits, contracts, etc.)
  const { data: projectFiles } = await supabase
    .from("project_files")
    .select("filename, storage_path, category")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);

  for (const f of projectFiles || []) {
    if (seen.has(f.filename.toLowerCase())) continue;
    files.push({
      filename: f.filename,
      storage_path: f.storage_path,
      bucket: "project-files",
      category: f.category,
      selected: ["construction_drawings", "specs", "estimates"].includes(f.category),
    });
    seen.add(f.filename.toLowerCase());
  }

  // 2. Email attachments (PDFs)
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
      files.push({
        filename: att.filename,
        storage_path: att.storage_path,
        bucket: "email-attachments",
        selected: false,
      });
      seen.add(att.filename.toLowerCase());
    }
  }

  return NextResponse.json({ files });
}
