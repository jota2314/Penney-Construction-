/**
 * Part B of auto-triage: "does this email deserve a reply?"
 *
 * After the triage pass has filed an inbound email's attachments, this helper
 * asks Haiku whether the email genuinely needs a written response and, if so,
 * drafts one in the Penney voice and parks it in `email_drafts`
 * (status="draft", origin="auto_triage") for Jorge to review and approve.
 *
 * Hard guarantees (these are why it's safe to run unattended):
 *  - NEVER sends. It only ever inserts a status="draft" row. Sending requires
 *    Jorge to open the draft and click send (that path uses his Gmail token).
 *  - NEVER drafts to a hallucinated address — the recipient is always the
 *    literal sender of the email we're replying to (no-reply senders skipped).
 *  - NEVER drafts for spam / internal / personal mail or newsletters.
 *  - Idempotent per source message: re-running triage won't pile up duplicate
 *    drafts for the same email.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnthropicClientServer } from "@/lib/ai/claude-server";
import { EMAIL_STYLE_GUIDE } from "@/lib/ai/email-style";

const MODEL = "claude-haiku-4-5-20251001";

/** The daemon runs for Jorge — every auto-draft is signed by him. */
const SIGNER = "Jorge Betancur";

export interface DraftReplyResult {
  /** true when a new email_drafts row was inserted */
  drafted: boolean;
  /** the new draft id, when drafted */
  draftId: string | null;
  /** short human-readable reason (logged in triage output) */
  reason: string;
}

const SKIP: DraftReplyResult = { drafted: false, draftId: null, reason: "" };

/** Senders we never auto-reply to. */
const NON_REPLY_SENDER_TYPES = new Set(["internal", "personal", "spam"]);

/** Obvious "no human is waiting on a reply" content. */
const NON_REPLY_CONTENT_TYPES = new Set(["newsletter"]);

function isNoReplyAddress(addr: string): boolean {
  const a = addr.toLowerCase();
  return (
    a.includes("no-reply") ||
    a.includes("noreply") ||
    a.includes("donotreply") ||
    a.includes("do-not-reply") ||
    a.includes("mailer-daemon")
  );
}

interface EmailRow {
  id: string;
  gmail_message_id: string | null;
  thread_id: string | null;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  to_name: string | null;
  body: string | null;
  snippet: string | null;
  ai_summary: string | null;
  ai_action_required: boolean | null;
  content_type: string | null;
  sender_type: string | null;
  urgency: string | null;
  direction: string | null;
}

/**
 * Consider an inbound email for an auto-drafted reply. Returns SKIP for the
 * common case (no reply needed / not eligible); returns a drafted result when a
 * new email_drafts row was created.
 *
 * @param projectId the project this email was resolved to (links the draft), or null.
 */
export async function maybeDraftReply(
  admin: SupabaseClient,
  opts: { emailId: string; projectId: string | null },
): Promise<DraftReplyResult> {
  const { emailId, projectId } = opts;

  const { data: emailRaw, error } = await admin
    .from("inbox_emails")
    .select(
      "id, gmail_message_id, thread_id, subject, from_name, from_email, to_name, body, snippet, ai_summary, ai_action_required, content_type, sender_type, urgency, direction",
    )
    .eq("id", emailId)
    .maybeSingle();

  if (error || !emailRaw) return SKIP;
  const email = emailRaw as EmailRow;

  // ── Cheap gates (no LLM) ──────────────────────────────────────────────
  if (email.direction && email.direction !== "inbound") return SKIP;
  if (!email.from_email || !email.from_email.includes("@")) return SKIP;
  if (isNoReplyAddress(email.from_email)) return SKIP;
  if (email.sender_type && NON_REPLY_SENDER_TYPES.has(email.sender_type)) return SKIP;
  if (email.urgency === "junk") return SKIP;
  if (email.content_type && NON_REPLY_CONTENT_TYPES.has(email.content_type)) return SKIP;

  // ── Idempotency: already have an auto-draft for this source message? ───
  if (email.gmail_message_id) {
    const { count } = await admin
      .from("email_drafts")
      .select("id", { count: "exact", head: true })
      .eq("origin", "auto_triage")
      .eq("in_reply_to", email.gmail_message_id);
    if ((count ?? 0) > 0) {
      return { drafted: false, draftId: null, reason: "draft already exists" };
    }
  }

  // ── Ask Haiku: needs a reply? if so, draft it. ────────────────────────
  const fromName =
    (email.from_name || email.from_email || "").split("(")[0].trim() ||
    email.from_email ||
    "there";
  const senderFirstName = fromName.split(/\s+/)[0] || fromName;
  const bodyExcerpt = (email.body || email.snippet || "").substring(0, 3000);
  const reSubject = (email.subject || "").startsWith("Re:")
    ? email.subject || ""
    : `Re: ${email.subject || ""}`.trim();

  const systemPrompt = `You decide whether an inbound email to Penney Construction (a residential GC in Massachusetts) genuinely needs a written reply from ${SIGNER}, and if so you draft that reply.

${EMAIL_STYLE_GUIDE}

## DECISION RULES
Set "needs_reply": true ONLY when a person is actually waiting on a written response — e.g. a question, a scheduling request, a request for information, a quote that should be acknowledged, a client raising a concern, an introduction that expects a reply.

Set "needs_reply": false for things that need no written reply — invoices/bills (those get PAID, not replied to), payment receipts, automated/service notifications, FYI status updates, "thanks" with nothing pending, marketing.

When unsure, prefer false. A missing draft is harmless; a pointless draft wastes Jorge's time.

## OUTPUT
Return ONLY this JSON (no markdown fences):
{
  "needs_reply": true | false,
  "reason": "<6 words max, why>",
  "subject": "${reSubject}",
  "body": "<the full reply, signed by ${SIGNER}, or empty string if needs_reply is false>"
}

If needs_reply is true:
- Open with "Hi ${senderFirstName}," — no other greeting
- Keep it short (under 90 words unless it genuinely needs more)
- Be specific: pull dates, dollar amounts, names straight from the email
- End with "${SIGNER.split(" ")[0]}" on its own line
- Do NOT invent facts (prices, dates, commitments) the email doesn't support — if you'd need info Penney hasn't provided, keep the reply to acknowledging + asking for what's needed.`;

  const userMsg = `EMAIL TO ASSESS:
From: ${email.from_name ?? ""} <${email.from_email}>
Subject: ${email.subject ?? ""}
${email.ai_summary ? `AI summary: ${email.ai_summary}\n` : ""}${email.content_type ? `Content type: ${email.content_type}\n` : ""}${email.sender_type ? `Sender type: ${email.sender_type}\n` : ""}
Body:
${bodyExcerpt}

Return the JSON now.`;

  let needsReply = false;
  let subject = reSubject;
  let body = "";
  let reason = "";
  try {
    const client = await getAnthropicClientServer();
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
    });
    const txt = resp.content.find((c) => c.type === "text");
    if (!txt || txt.type !== "text") return SKIP;
    const raw = txt.text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(raw) as {
      needs_reply?: boolean;
      reason?: string;
      subject?: string;
      body?: string;
    };
    needsReply = !!parsed.needs_reply;
    reason = (parsed.reason || "").substring(0, 80);
    if (parsed.subject && parsed.subject.trim()) subject = parsed.subject.trim();
    body = (parsed.body || "").trim();
  } catch (e) {
    console.error(`[draft-reply] read failed for email ${emailId}:`, (e as Error).message);
    return SKIP;
  }

  if (!needsReply || !body) {
    return { drafted: false, draftId: null, reason: reason || "no reply needed" };
  }

  // ── Park the draft for review. Never sends. ───────────────────────────
  const { data: inserted, error: insErr } = await admin
    .from("email_drafts")
    .insert({
      to_emails: [email.from_email],
      cc_emails: [],
      bcc_emails: [],
      subject,
      body,
      file_ids: [],
      project_id: projectId,
      in_reply_to: email.gmail_message_id,
      gmail_thread_id: email.thread_id,
      status: "draft",
      origin: "auto_triage",
      created_by: "auto_triage",
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    console.error(`[draft-reply] insert failed for email ${emailId}:`, insErr?.message);
    return SKIP;
  }

  return { drafted: true, draftId: inserted.id as string, reason: reason || "reply drafted" };
}
