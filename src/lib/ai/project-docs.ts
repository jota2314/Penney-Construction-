/**
 * Shared helper for every chat: load the project's registered documents
 * into a plain-text block that can be appended to any system prompt.
 *
 * Why: AIs will sometimes tell the user "no drawings uploaded" without
 * actually calling list_project_documents. Pre-loading the docs directly
 * into the system prompt removes that failure mode — the AI always sees
 * what's available before it decides what to say.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadProjectDocsContext(
  supabase: SupabaseClient,
  projectId: string | null | undefined,
): Promise<string> {
  if (!projectId) return "";

  try {
    const [pfRes, invRes] = await Promise.all([
      supabase.from("project_files")
        .select("filename, category, storage_path, mime_type")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabase.from("inbox_emails")
        .select("subject, attachments")
        .eq("project_id", projectId)
        .not("attachments", "is", null)
        .limit(20),
    ]);

    const lines: string[] = [];
    for (const f of (pfRes.data as Array<{ filename: string; category: string | null; storage_path: string }> | null) || []) {
      lines.push(`- ${f.filename} [${f.category || "file"}] — storage_path: ${f.storage_path}`);
    }
    for (const e of (invRes.data as Array<{ subject: string; attachments: unknown }> | null) || []) {
      const atts = Array.isArray(e.attachments) ? (e.attachments as Array<{ filename?: string; storage_path?: string }>) : [];
      for (const a of atts) {
        if (!a?.storage_path) continue;
        lines.push(`- ${a.filename || "attachment"} [email: "${e.subject}"] — storage_path: ${a.storage_path}`);
      }
    }

    if (lines.length === 0) {
      return `\n\n## PROJECT DOCUMENTS (live snapshot)\n(no files registered on this project yet — list_project_documents will confirm)`;
    }
    return `\n\n## PROJECT DOCUMENTS ALREADY REGISTERED (live snapshot — attach these directly; do NOT tell the user to upload)\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}
