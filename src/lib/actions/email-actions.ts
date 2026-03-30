"use server";

import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/google/gmail";

/**
 * Mark an email as processed (Done button)
 */
export async function markEmailProcessed(emailId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("inbox_emails")
    .update({ is_processed: true })
    .eq("id", emailId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Link an email to a project by project name
 */
export async function linkEmailToProject(
  emailId: string,
  projectName: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  // Find project by name (case-insensitive)
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .ilike("name", projectName)
    .single();

  if (!project) return { success: false, error: `Project "${projectName}" not found` };

  const { error } = await supabase
    .from("inbox_emails")
    .update({ project_id: project.id })
    .eq("id", emailId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Send an email reply via Gmail
 */
export async function sendEmailReply(input: {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  cc?: string;
  threadId?: string;
  inReplyTo?: string;
  attachments?: { filename: string; mimeType: string; content: string }[];
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const result = await sendEmail({
      to: input.to,
      subject: input.subject,
      body: input.body,
      replyTo: input.replyTo,
      cc: input.cc,
      threadId: input.threadId,
      inReplyTo: input.inReplyTo,
      attachments: input.attachments,
    });

    return { success: true, messageId: result.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send email",
    };
  }
}

/**
 * Download files from Supabase storage and convert to base64 for email attachment.
 */
export async function downloadAttachmentsForEmail(
  storagePaths: { storagePath: string; filename: string; mimeType: string }[]
): Promise<{ filename: string; mimeType: string; content: string }[]> {
  const supabase = await createClient();
  const results: { filename: string; mimeType: string; content: string }[] = [];

  for (const att of storagePaths) {
    const { data, error } = await supabase.storage
      .from("email-attachments")
      .download(att.storagePath);

    if (error || !data) continue;

    const buffer = Buffer.from(await data.arrayBuffer());
    results.push({
      filename: att.filename,
      mimeType: att.mimeType,
      content: buffer.toString("base64"),
    });
  }

  return results;
}
