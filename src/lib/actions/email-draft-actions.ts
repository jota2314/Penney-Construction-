"use server";

/**
 * Server actions for the email-draft review page (`/email-draft/[id]`).
 *
 * The MCP `draft_email` tool (and the auto-triage daemon) park composed emails
 * in the `email_drafts` table with status="draft" and hand the user a
 * `/email-draft/{id}` link. This is where that link lands: the user reviews /
 * edits the draft and either sends it (through their Gmail token) or discards
 * it. Nothing here ever sends without an explicit click.
 */

import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";

interface DraftEditableFields {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Resolve `email_drafts.file_ids` (project_files UUIDs) into base64 Gmail
 * attachments. Files may live in either storage bucket, so try both.
 */
async function resolveAttachments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fileIds: string[],
): Promise<{ filename: string; mimeType: string; content: string }[]> {
  if (!fileIds || fileIds.length === 0) return [];

  const { data: files } = await supabase
    .from("project_files")
    .select("id, filename, storage_path, mime_type")
    .in("id", fileIds);

  const attachments: { filename: string; mimeType: string; content: string }[] = [];
  for (const file of files || []) {
    if (!file.storage_path) continue;
    try {
      let blob: Blob | null = null;
      const { data: d1 } = await supabase.storage
        .from("project-files")
        .download(file.storage_path);
      blob = d1;
      if (!blob) {
        const { data: d2 } = await supabase.storage
          .from("email-attachments")
          .download(file.storage_path);
        blob = d2;
      }
      if (blob) {
        const buffer = await blob.arrayBuffer();
        attachments.push({
          filename: file.filename,
          mimeType: file.mime_type || "application/octet-stream",
          content: Buffer.from(buffer).toString("base64"),
        });
      } else {
        console.error(
          `[email-draft] attachment ${file.filename} not found in either bucket (path: ${file.storage_path})`,
        );
      }
    } catch (err) {
      console.error(`[email-draft] failed to download ${file.filename}:`, err);
    }
  }
  return attachments;
}

/**
 * Send a parked draft. Applies the user's latest edits, resolves attachments,
 * sends through Gmail, and flips the draft to status="sent".
 */
export async function sendDraftEmail(
  draftId: string,
  edited: DraftEditableFields,
): Promise<SendResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const { data: draft, error: fetchErr } = await supabase
    .from("email_drafts")
    .select("id, file_ids, in_reply_to, gmail_thread_id, status, project_id")
    .eq("id", draftId)
    .maybeSingle();

  if (fetchErr || !draft) return { success: false, error: "Draft not found" };
  if (draft.status === "sent") return { success: false, error: "This draft was already sent" };

  const to = edited.to.map((s) => s.trim()).filter(Boolean);
  if (to.length === 0) return { success: false, error: "At least one recipient is required" };
  if (!edited.subject.trim()) return { success: false, error: "Subject is required" };

  try {
    const attachments = await resolveAttachments(
      supabase,
      (draft.file_ids as string[] | null) || [],
    );

    const result = await sendEmail({
      to: to.join(", "),
      cc: edited.cc.map((s) => s.trim()).filter(Boolean).join(", ") || undefined,
      bcc: edited.bcc.map((s) => s.trim()).filter(Boolean).join(", ") || undefined,
      subject: edited.subject,
      body: edited.body,
      threadId: draft.gmail_thread_id || undefined,
      inReplyTo: draft.in_reply_to || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    // Persist the user's edits alongside the sent state for the record.
    await supabase
      .from("email_drafts")
      .update({
        to_emails: to,
        cc_emails: edited.cc.map((s) => s.trim()).filter(Boolean),
        bcc_emails: edited.bcc.map((s) => s.trim()).filter(Boolean),
        subject: edited.subject,
        body: edited.body,
        status: "sent",
        sent_at: new Date().toISOString(),
        gmail_message_id: result.id,
        error_message: null,
      })
      .eq("id", draftId);

    return { success: true, messageId: result.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send email";
    await supabase
      .from("email_drafts")
      .update({ status: "error", error_message: message })
      .eq("id", draftId);
    return { success: false, error: message };
  }
}

/**
 * Discard a parked draft (soft delete — keeps the row for audit).
 */
export async function discardDraftEmail(
  draftId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("email_drafts")
    .update({ status: "discarded" })
    .eq("id", draftId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}
