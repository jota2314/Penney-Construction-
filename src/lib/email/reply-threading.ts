import type { SupabaseClient } from "@supabase/supabase-js";

export interface ReplyThreading {
  threadId?: string;
  inReplyTo?: string;
}

/**
 * Normalize a value into an RFC 822 Message-ID header form (`<id@domain>`),
 * or null when it can't possibly be one. Gmail's short hex message ids (no
 * `@`) return null — putting those in an In-Reply-To header is what breaks
 * recipient-side threading.
 */
export function formatRfc822MessageId(value: string | null | undefined): string | null {
  const v = (value || "").trim();
  if (!v || !v.includes("@")) return null;
  return v.startsWith("<") ? v : `<${v}>`;
}

/**
 * Resolve an `email_drafts.in_reply_to` reference into real Gmail threading
 * params. Callers store the reference in three shapes: an RFC 822 Message-ID,
 * a Gmail hex message id, or an `inbox_emails` UUID. The hex/UUID shapes are
 * useless as an In-Reply-To header and carry no thread id, so look the source
 * message up in `inbox_emails` and return both the Gmail thread id (threads
 * the conversation in our mailbox) and the RFC 822 id (threads it in the
 * recipient's). A known thread id from the draft row wins when present.
 */
export async function resolveReplyThreading(
  db: SupabaseClient,
  reference: string | null | undefined,
  knownThreadId?: string | null,
): Promise<ReplyThreading> {
  const ref = (reference || "").trim();
  const fallback: ReplyThreading = {
    threadId: knownThreadId || undefined,
    inReplyTo: formatRfc822MessageId(ref) || undefined,
  };
  if (!ref) return fallback;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ref);
  const isGmailId = /^[0-9a-f]{12,20}$/i.test(ref);
  const rfcForm = formatRfc822MessageId(ref);

  let query = db.from("inbox_emails").select("thread_id, rfc822_message_id");
  if (isUuid) query = query.eq("id", ref);
  else if (isGmailId) query = query.eq("gmail_message_id", ref);
  else if (rfcForm) query = query.eq("rfc822_message_id", rfcForm);
  else return fallback;

  const { data: row } = await query.maybeSingle();
  if (!row) return fallback;

  return {
    threadId: knownThreadId || row.thread_id || undefined,
    inReplyTo: formatRfc822MessageId(row.rfc822_message_id) || fallback.inReplyTo,
  };
}
