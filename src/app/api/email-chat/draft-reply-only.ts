import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAnthropicClient,
  CLAUDE_FALLBACK_MODELS,
  logAiUsage,
} from "@/lib/ai/claude";
import { EMAIL_STYLE_GUIDE } from "@/lib/ai/email-style";

/**
 * Quick Reply branch of /api/email-chat.
 *
 * Skips the full triage prompt, attachment extraction, memory loading, etc.
 * Returns ONLY a single draft_reply action so the UI can pop it straight
 * into the Quick Reply bottom sheet.
 *
 * Optional `regenerateHint` (e.g. "shorter", "more formal", "decline politely",
 * "ask for a date", or a custom string) is appended to the prompt.
 */
export async function handleDraftReplyOnly(opts: {
  supabase: SupabaseClient;
  userId: string;
  emailId: string;
  userName?: string;
  regenerateHint?: string;
}) {
  const { supabase, userId, emailId, userName, regenerateHint } = opts;

  const { data: email } = await supabase
    .from("inbox_emails")
    .select(
      "id, subject, from_name, from_email, to_name, to_email, date, body, snippet, ai_summary, content_type"
    )
    .eq("id", emailId)
    .single();

  if (!email) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  // Sender's display name — strip company suffixes like "(Penney Construction)"
  const fromName =
    (email.from_name || email.from_email || "").split("(")[0].trim() ||
    email.from_email ||
    "there";
  const senderFirstName = fromName.split(/\s+/)[0] || fromName;

  const signer = userName || "Team";

  const bodyExcerpt = (email.body || email.snippet || "").substring(0, 3000);

  const systemPrompt = `You are drafting a short email reply on behalf of ${signer} at Penney Construction (a residential GC in Massachusetts).

${EMAIL_STYLE_GUIDE}

## YOUR JOB
Read the email below and draft ONE reply. Return it as JSON:

{
  "message": "One short sentence describing the draft (e.g. 'Drafted a quick reply confirming Friday at 10.').",
  "proposed_actions": [
    {
      "type": "draft_reply",
      "label": "Reply to ${fromName}",
      "data": {
        "to_email": "${email.from_email}",
        "to_name": "${fromName}",
        "subject": "${(email.subject || "").startsWith("Re:") ? email.subject : `Re: ${email.subject || ""}`}",
        "body": "<the full reply, signed by ${signer}>"
      }
    }
  ]
}

Rules:
- Open with "Hi ${senderFirstName}," — no other greeting
- Keep it short (under 80 words unless the reply genuinely needs more)
- Be specific: dates, dollar amounts, names — pull straight from the email
- End with the signer's name on its own line
- Output ONLY the JSON object, no markdown fences, no other text`;

  const userMsg = `EMAIL TO REPLY TO:
From: ${email.from_name} <${email.from_email}>
To: ${email.to_name} <${email.to_email}>
Date: ${email.date}
Subject: ${email.subject}
${email.ai_summary ? `\nAI summary: ${email.ai_summary}` : ""}
${email.content_type ? `Content type: ${email.content_type}` : ""}

Body:
${bodyExcerpt}
${regenerateHint ? `\n---\nRegenerate the draft with this guidance: ${regenerateHint}` : ""}

Return the JSON now.`;

  const anthropic = await getAnthropicClient();
  let rawContent = "";

  for (const model of CLAUDE_FALLBACK_MODELS) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }],
      });
      rawContent =
        response.content[0]?.type === "text"
          ? response.content[0].text.trim()
          : "";
      if (rawContent) {
        if (response.usage) {
          logAiUsage({
            userId,
            endpoint: "email-chat:draft_reply_only",
            model,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            context: `email:${emailId}${regenerateHint ? `|regen:${regenerateHint.substring(0, 40)}` : ""}`,
          });
        }
        break;
      }
    } catch {
      continue;
    }
  }

  if (!rawContent) {
    return NextResponse.json(
      { error: "All Claude models failed." },
      { status: 500 }
    );
  }

  // Parse JSON (same robust strategy as main route)
  const cleaned = rawContent
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let message = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let proposed_actions: any[] = [];

  try {
    const obj = JSON.parse(cleaned);
    message = typeof obj.message === "string" ? obj.message : "";
    proposed_actions = Array.isArray(obj.proposed_actions)
      ? obj.proposed_actions
      : [];
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        const obj = JSON.parse(cleaned.substring(start, end + 1));
        message = typeof obj.message === "string" ? obj.message : "";
        proposed_actions = Array.isArray(obj.proposed_actions)
          ? obj.proposed_actions
          : [];
      } catch {
        // fall through
      }
    }
  }

  // Keep only the draft_reply
  proposed_actions = proposed_actions
    .filter((a) => a?.type === "draft_reply")
    .slice(0, 1);

  if (proposed_actions.length === 0) {
    // Last-ditch: synthesize a draft from raw text
    proposed_actions = [
      {
        type: "draft_reply",
        label: `Reply to ${fromName}`,
        data: {
          to_email: email.from_email,
          to_name: fromName,
          subject: (email.subject || "").startsWith("Re:")
            ? email.subject
            : `Re: ${email.subject || ""}`,
          body: cleaned,
        },
      },
    ];
    message = "Drafted a reply.";
  }

  return NextResponse.json({
    message: message || "Drafted a reply.",
    proposed_actions,
  });
}
