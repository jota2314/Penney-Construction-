/**
 * Email-context loader for the unified chat.
 *
 * Phase 1 of unifying /api/chat and /api/email-chat: the main chat
 * accepts an `emailId` and we inject the email's body, attachments,
 * and thread metadata into the system prompt — exactly the same way
 * `projectId` injects project context today.
 *
 * This means the floating AI Assistant can do everything the email
 * triage chat does, with no duplication of triage-specific logic.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractAttachmentText,
  type AttachmentMeta,
} from "@/lib/actions/extract-attachment";

export interface EmailContextEmail {
  id: string;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  to_email: string | null;
  date: string | null;
  direction: string | null;
  body: string | null;
  snippet: string | null;
  thread_id: string | null;
  gmail_message_id: string | null;
  is_processed: boolean | null;
  project_id: string | null;
  attachments: AttachmentMeta[];
}

/**
 * Load an email and extract attachment text. Caches extracted text back
 * on the email row so subsequent calls don't re-process the same PDFs.
 * Returns null if the email doesn't exist or the user can't read it.
 */
export async function loadEmailForChat(
  supabase: SupabaseClient,
  emailId: string,
): Promise<EmailContextEmail | null> {
  const { data: email } = await supabase
    .from("inbox_emails")
    .select("*")
    .eq("id", emailId)
    .maybeSingle();

  if (!email) return null;

  const attachments = (email.attachments || []) as AttachmentMeta[];
  try {
    const { attachments: processed, updated } = await extractAttachmentText(
      supabase,
      attachments,
    );
    if (updated) {
      await supabase
        .from("inbox_emails")
        .update({ attachments: processed })
        .eq("id", emailId);
    }
    email.attachments = processed;
  } catch {
    // Continue without extraction — don't break chat over a single bad PDF
  }

  return email as EmailContextEmail;
}

/**
 * Format an email as a system-prompt block. Mirrors the structure used
 * in src/lib/ai/prompts/email-triage.ts so the AI sees the same shape
 * whether it's running through the unified chat or the legacy triage.
 */
export function buildEmailContextBlock(email: EmailContextEmail): string {
  const attachmentLines = (email.attachments || []).map((a) => {
    const head = `- ${a.filename} (${a.mimeType})`;
    if (a.text_content) {
      return `${head}\n  storage_path: "${a.storage_path}"\n  Content (truncated to 8k):\n${a.text_content.substring(0, 8000)}`;
    }
    return `${head}\n  storage_path: "${a.storage_path ?? ""}"`;
  });

  const lines = [
    "",
    "## Active Email",
    "You are currently viewing this email. Use it as the primary context for the user's questions and actions.",
    "",
    `- **Subject:** ${email.subject ?? "(no subject)"}`,
    `- **From:** ${email.from_name ?? ""} <${email.from_email ?? ""}>`,
    `- **To:** ${email.to_email ?? ""}`,
    `- **Date:** ${email.date ?? "(unknown)"}`,
    `- **Direction:** ${email.direction ?? "(unknown)"}`,
    `- **Email UUID:** ${email.id}`,
    `- **Gmail message id:** ${email.gmail_message_id ?? "(none)"}`,
    `- **Thread id:** ${email.thread_id ?? "(none)"}`,
    `- **Already linked to project:** ${email.project_id ?? "no"}`,
    `- **Already processed:** ${email.is_processed ? "yes" : "no"}`,
    "",
    "### Body",
    (email.body || email.snippet || "(empty)").substring(0, 6000),
    "",
  ];

  if (attachmentLines.length > 0) {
    lines.push("### Attachments");
    lines.push(
      "When attaching one of these to a draft_email, copy the storage_path EXACTLY as shown — do not infer from the filename.",
    );
    lines.push(...attachmentLines);
    lines.push("");
  }

  lines.push("### Email-context guidance");
  lines.push(
    "- When the user says 'this email', 'reply', 'send it', etc., they mean the email above.",
  );
  lines.push(
    "- Use `link_email_to_project` (with the Email UUID above) when the user asks to file the email under a project.",
  );
  lines.push(
    "- For replies, prefer `draft_email` with reply_to_message_id set to the Gmail message id above so threading is preserved.",
  );
  lines.push("");

  return lines.join("\n");
}
