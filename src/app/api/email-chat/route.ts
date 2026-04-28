import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleFetch } from "@/lib/google/auth";
import {
  getAnthropicClient,
  CLAUDE_FALLBACK_MODELS,
  logAiUsage,
} from "@/lib/ai/claude";
import {
  extractAttachmentText,
  type AttachmentMeta,
} from "@/lib/actions/extract-attachment";
import { buildEmailTriagePrompt } from "@/lib/ai/prompts/email-triage";
import { loadEmailTriageContext } from "@/lib/ai/shared-context";
import { loadMemories, loadActionPatterns, parseRememberCommand, saveMemory } from "@/lib/ai/memory";
import { handleDraftReplyOnly } from "@/app/api/email-chat/draft-reply-only";

const AUTO_ANALYZE_PROMPT = `Analyze this email and DO EVERYTHING it needs — don't just describe it, take action. For every email:
1. Create/link the project if it's a real job
2. Create customers and subs from the email — but CHECK THE EXISTING DATABASE FIRST. If a person already exists (even under a slightly different name or company), do NOT create a duplicate.
3. Save any quotes, invoices, or files attached
4. Create todos for any follow-up work needed (with the right category: quotes, estimates, scheduling, follow_up_quotes, follow_up_clients, permits_inspections, materials, change_orders, payments, contracts_docs)
5. Do NOT auto-draft a reply. Instead, at the end of your message, ASK the user: "Would you like me to draft a reply?" Only draft if they say yes.
6. If it's spam, newsletter, or truly irrelevant → skip

We're in setup mode — building the company database from historical emails. Be aggressive about creating projects and extracting data. Propose ALL actions at once so the user just clicks approve.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const {
      emailId,
      messages: clientMessages,
      userMessage,
      conversationId: incomingConvId,
      autoAnalyze,
      userName,
      currentDraft,
      attachments: userAttachments = [],
      intent,
      regenerateHint,
    } = await request.json();

    if (!emailId)
      return NextResponse.json(
        { error: "emailId required" },
        { status: 400 }
      );

    // ── Quick Reply: lightweight branch that returns ONLY a draft_reply ─
    if (intent === "draft_reply_only") {
      return handleDraftReplyOnly({
        supabase,
        userId: user.id,
        emailId,
        userName,
        regenerateHint,
      });
    }

    // Load email from Supabase
    const { data: email } = await supabase
      .from("inbox_emails")
      .select("*")
      .eq("id", emailId)
      .single();

    if (!email)
      return NextResponse.json({ error: "Email not found" }, { status: 404 });

    // ── Find or create conversation ──────────────────────────
    let conversationId = incomingConvId;
    if (!conversationId) {
      const { data: existing } = await supabase
        .from("conversations")
        .select("id")
        .eq("inbox_email_id", emailId)
        .single();

      if (existing) {
        conversationId = existing.id;
      } else {
        const { data: newConv } = await supabase
          .from("conversations")
          .insert({
            user_id: user.id,
            inbox_email_id: emailId,
            title: email.subject?.substring(0, 200) || "Email triage",
          })
          .select("id")
          .single();
        conversationId = newConv?.id;
      }
    }

    // ── Build the actual prompt ──────────────────────────────
    const actualUserMessage = autoAnalyze
      ? AUTO_ANALYZE_PROMPT
      : userMessage;

    if (!actualUserMessage)
      return NextResponse.json(
        { error: "userMessage required" },
        { status: 400 }
      );

    // ── Handle "remember" commands ──────────────────────────
    if (!autoAnalyze && actualUserMessage) {
      const rememberCmd = await parseRememberCommand(actualUserMessage);
      if (rememberCmd.isRemember && rememberCmd.key && rememberCmd.value) {
        await saveMemory(rememberCmd.category!, rememberCmd.key, rememberCmd.value, "user_taught");
        // Still send to AI so it acknowledges, but the memory is already saved
      }
    }

    // Save user message to conversation (skip for auto-analyze)
    if (!autoAnalyze && conversationId) {
      await supabase.from("conversation_messages").insert({
        conversation_id: conversationId,
        role: "user",
        content: actualUserMessage,
        source: "text",
      });
    }

    // ── Load DB context + AI memory in parallel ──────────────
    const [triageContext, memoryContext, patternContext] = await Promise.all([
      loadEmailTriageContext(supabase),
      loadMemories(supabase, user.id),
      loadActionPatterns(supabase, user.id),
    ]);

    // ── Extract text from PDF attachments on-demand ────────
    const attachments = (email.attachments || []) as AttachmentMeta[];

    try {
      const { attachments: processed, updated } =
        await extractAttachmentText(supabase, attachments);
      if (updated) {
        await supabase
          .from("inbox_emails")
          .update({ attachments: processed })
          .eq("id", emailId);
      }
    } catch {
      // Extraction failed — continue without it
    }

    // ── Extract text from Google Docs/Sheets linked in email body ────
    const driveContent = await extractDriveContent(email.body || "");

    const attachmentInfo =
      attachments.length > 0 || driveContent.length > 0
        ? [
            ...(attachments.length > 0
              ? [`Attachments:\n${attachments
                  .map((a) => {
                    let info = `- ${a.filename} (${a.mimeType})`;
                    if (a.text_content) {
                      info += `\n  Content:\n${a.text_content.substring(0, 8000)}`;
                    }
                    return info;
                  })
                  .join("\n")}`]
              : []),
            ...(driveContent.length > 0
              ? [`Linked Google Documents:\n${driveContent
                  .map((d) => `- ${d.name} (${d.type})\n  Content:\n${d.text.substring(0, 8000)}`)
                  .join("\n")}`]
              : []),
          ].join("\n\n")
        : "No attachments";

    // Get current user's name from their profile
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();
    const currentUser = userProfile?.full_name || userName || user.email?.split("@")[0] || "Team";

    // ── Build system prompt via shared prompt builder ────────
    const systemPrompt = await buildEmailTriagePrompt({
      email: {
        id: emailId,
        gmail_message_id: email.gmail_message_id,
        subject: email.subject,
        from_name: email.from_name,
        from_email: email.from_email,
        to_email: email.to_email,
        date: email.date,
        direction: email.direction,
        body: `${(email.body || email.snippet || "").substring(0, 4000)}${attachmentInfo !== "No attachments" ? `\n\n${attachmentInfo}` : ""}`,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          mime_type: a.mimeType,
          text_content: a.text_content?.substring(0, 8000),
        })),
      },
      ...triageContext,
      userName: currentUser,
    }) + `

## ACTIONS YOU CAN PROPOSE
- create_project: { name, address, city, state, project_type, status, description, customer_name, estimated_value, scope_of_work, required_trades }
- update_project: { project_name, address, city, state, description, estimated_value, contract_value, scope_of_work, status, phase }
- create_customer: { first_name, last_name, email, phone, address, city, state }
- create_subcontractor: { company_name, contact_name, email, phone, trades }
  - trades MUST be a JSON array of strings like ["electrical", "plumbing"]
  - **CRITICAL — CHECK FOR DUPLICATES FIRST**: Match by contact_name, company_name, OR email. Nicknames: Chuck=Charles, Bob=Robert, Bill=William, Mike=Michael, Jim=James
- create_quote: { subcontractor_name, project_name, trade, amount, scope_description, status, document_type, attachment_storage_path, extracted_text }
  - Use for QUOTES, ESTIMATES, PROPOSALS. amount: ALWAYS extract dollar amount from PDF. attachment_storage_path: use EXACT storage_path from metadata.
  - status MUST be one of: just_sent, awaiting_reply, received, accepted, declined, approved. Use "received" for quotes/proposals received from subs.
- create_invoice: { vendor_name, project_name, trade, amount, invoice_number, invoice_date, due_date, terms, description, vendor_type, attachment_storage_path, extracted_text }
  - Use for INVOICES/BILLS. ALWAYS extract: invoice_number, invoice_date, due_date, amount.
- record_payment: { project_name, payment_type, amount, received_date, method, reference_number, description }
  - Use when email confirms a client payment (deposit, draw, progress, final). payment_type: deposit, draw, progress, final, change_order, retainage, other.
- create_change_order: { project_name, title, description, cost_impact, price_impact, status }
  - Use when email discusses scope/cost changes. cost_impact = what it costs us, price_impact = what we charge client.
- save_project_file: { project_name, filename, storage_path, category, mime_type, size, description }
  - category: construction_drawings, specs, pricing, contracts, permits, photos, invoices, estimates, other
- create_todo: { contact_name, description, priority, project_name, category, due_date }
  - Todos are SELF-REMINDERS for the current user ("I need to..."). Never assign to other people.
  - category: quotes, estimates, scheduling, follow_up_quotes, follow_up_clients, permits_inspections, materials, change_orders, payments, contracts_docs, general
- schedule_event: { name, project_name, start_datetime, end_datetime, description, event_type, location }
  - event_type: meeting, walkthrough, inspection, phase
- link_email_to_project: { project_name }
- draft_reply: { to_email, to_name, subject, body, cc, attachment_paths }
  - THREADING: Reply to sender = same thread. Email to different person = new thread. NEVER CC customer when emailing subs about pricing.
  - **CRITICAL: When the user asks you to draft/write/send an email, ALWAYS return it as a draft_reply action in proposed_actions. NEVER write the email text directly in your message. The draft_reply action opens the compose editor where the user can review and edit before sending.**
- skip: {}

## RESPONSE FORMAT — CRITICAL
Your ENTIRE response must be a single JSON object:
{
  "message": "Your conversational response — all of it",
  "proposed_actions": [
    { "type": "action_type", "label": "Short description", "data": { ... } }
  ]
}

## DRAFTING EMAILS — IMPORTANT
When the user asks you to draft, write, or send an email:
1. Put a SHORT summary in "message" (e.g., "Here's a draft to Paul about the HVAC work tomorrow.")
2. Put the FULL email in a draft_reply action in proposed_actions with to_email, subject, and body
3. NEVER put the full email text in the message field — it must go in draft_reply so the compose editor opens

## BE PROACTIVE — DO EVERYTHING IN ONE SHOT
For EVERY email, create ALL needed actions at once (link + todo + quote + etc). The user just clicks approve.
Do NOT auto-draft a reply. ASK the user first: "Would you like me to draft a reply?"

## RULES
- Project names: "LastName ProjectType" (e.g., "Gouthro Addition")
- Extract EVERYTHING: addresses, phones, emails, dollar amounts
- When creating a project, ALSO create_customer + link_email_to_project
- NEVER fabricate data — only use what's in the email
- NEVER guess or invent email addresses. Only use emails from the database, the current email thread, or that the user explicitly provides. If you don't have an email address, ASK the user for it.
- Status: lead, estimating, proposal_sent, contracted, in_progress, completed, cancelled
- project_type: remodel, addition, kitchen, bathroom, new_construction, other (NO "renovation")
- Default state: MA${
      currentDraft
        ? `

## ACTIVE DRAFT REPLY — USER IS EDITING
To: ${currentDraft.to || ""} | CC: ${currentDraft.cc || ""} | Subject: ${currentDraft.subject || ""}
Body: ${currentDraft.body || ""}
Return an UPDATED draft_reply with FULL revised content.`
        : ""
    }

## IMPORTANT: DO NOT RE-PROPOSE ACTIONS
If you see "[ACTIONS ALREADY PROPOSED" in history, do NOT re-propose. Only propose NEW actions.

## NO SEARCH / FIND ACTIONS
The only valid proposed_actions are the ones listed above. You have NO search tool here — the subs, customers, and projects database is already pasted into this prompt. When you need to look up a person (e.g. "Brad"), scan the Subcontractors list in the prompt and use that email directly. NEVER propose an action like "search_subcontractors", "find_contact", "find Brad's info", etc. — those aren't real action types and clicking Approve on them does nothing. If you truly can't find someone, just ask the user for the email in your "message".

## REMEMBER COMMAND
If the user says "remember that...", "note that...", "always...", "never...", or "from now on..." — acknowledge it naturally. The system has already saved the memory. Just confirm you'll remember it and continue with whatever else they need.
${memoryContext}${patternContext}`;

    // ── Build Claude messages ────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claudeMessages: Array<{ role: "user" | "assistant"; content: any }> =
      [];
    if (clientMessages && Array.isArray(clientMessages)) {
      for (const msg of clientMessages.slice(-20)) {
        claudeMessages.push({ role: msg.role, content: msg.content });
      }
    }
    // Process user-uploaded attachments — download from storage and build content blocks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attachmentBlocks: any[] = [];
    let attachmentContext = "";

    if (userAttachments && Array.isArray(userAttachments) && userAttachments.length > 0) {
      for (const att of userAttachments as Array<{ storagePath?: string; filename: string; mimeType: string }>) {
        if (!att.storagePath) continue;
        try {
          const { data: blob } = await supabase.storage
            .from("email-attachments")
            .download(att.storagePath);
          if (blob) {
            const buffer = Buffer.from(await blob.arrayBuffer());
            const base64 = buffer.toString("base64");
            const isPdf = att.mimeType === "application/pdf" || att.filename?.endsWith(".pdf");
            const isImage = att.mimeType?.startsWith("image/");

            if (isPdf) {
              attachmentBlocks.push({
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64 },
              });
              attachmentContext += `\n\n[User attached PDF: ${att.filename}]\nStorage path: ${att.storagePath}\nTo attach this file to an email, use storage_path: "${att.storagePath}" and filename: "${att.filename}" in draft_email attachments.`;
            } else if (isImage) {
              attachmentBlocks.push({
                type: "image",
                source: { type: "base64", media_type: att.mimeType, data: base64 },
              });
              attachmentContext += `\n\n[User attached image: ${att.filename}]\nStorage path: ${att.storagePath}\nTo attach this file to an email, use storage_path: "${att.storagePath}" and filename: "${att.filename}" in draft_email attachments.`;
            } else {
              const text = await blob.text();
              attachmentContext += `\n\n[User attached file: ${att.filename}]\nStorage path: ${att.storagePath}\nTo attach this file to an email, use storage_path: "${att.storagePath}" and filename: "${att.filename}" in draft_email attachments.\n${text.substring(0, 10000)}`;
            }
          }
        } catch {
          attachmentContext += `\n\n[Failed to load attachment: ${att.filename}]`;
        }
      }
    }

    // Build the user message — with or without attachment content blocks
    if (attachmentBlocks.length > 0) {
      const contentBlocks = [
        ...attachmentBlocks,
        { type: "text", text: (actualUserMessage || "[See attached document]") + attachmentContext },
      ];
      claudeMessages.push({ role: "user", content: contentBlocks });
    } else {
      claudeMessages.push({ role: "user", content: actualUserMessage + attachmentContext });
    }

    // ── Call Claude ──────────────────────────────────────────
    const anthropic = await getAnthropicClient();
    let rawContent = "";

    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: claudeMessages as any,
        });
        rawContent =
          response.content[0]?.type === "text"
            ? response.content[0].text.trim()
            : "";
        if (rawContent) {
          if (response.usage) {
            logAiUsage({
              userId: user.id,
              endpoint: "email-chat",
              model,
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
              context: `email:${emailId}`,
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
        { error: "All Claude models failed. Check your Anthropic API key." },
        { status: 500 }
      );
    }

    // ── Parse response ───────────────────────────────────────
    // Claude sometimes wraps JSON in markdown fences or adds text before it.
    // Extract the JSON object robustly.
    let message: string = "";
    let proposed_actions: {
      type: string;
      label: string;
      data: Record<string, unknown>;
    }[] = [];

    // Strip markdown fences first
    let cleaned = rawContent
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed = false;

    // Try 1: Direct JSON.parse on cleaned content
    try {
      const obj = JSON.parse(cleaned);
      if (obj && typeof obj.message === "string") {
        message = obj.message;
        proposed_actions = obj.proposed_actions || [];
        parsed = true;
      }
    } catch {
      // continue to fallback
    }

    // Try 2: Find the outermost { ... } and parse that
    if (!parsed) {
      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        const jsonStr = cleaned.substring(jsonStart, jsonEnd + 1);
        try {
          const obj = JSON.parse(jsonStr);
          if (obj && typeof obj.message === "string") {
            message = obj.message;
            proposed_actions = obj.proposed_actions || [];
            parsed = true;
          }
        } catch {
          // continue to fallback
        }
      }
    }

    // Try 3: Regex extract the "message" field value as a last resort
    if (!parsed) {
      const msgMatch = cleaned.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (msgMatch) {
        try {
          message = JSON.parse(`"${msgMatch[1]}"`);
        } catch {
          message = msgMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
        }
        // Try to extract proposed_actions separately
        const actMatch = cleaned.match(/"proposed_actions"\s*:\s*(\[[\s\S]*\])/);
        if (actMatch) {
          try {
            proposed_actions = JSON.parse(actMatch[1]);
          } catch {
            proposed_actions = [];
          }
        }
        parsed = true;
      }
    }

    // Final fallback: use raw text as message
    if (!parsed) {
      message = cleaned;
    }

    // ── Strip hallucinated pseudo-actions ───────────────────
    // Email chat has no tools. If Claude proposes "search_*", "find_*", or
    // anything that isn't a real action handler, drop it — clicking Approve
    // on it does nothing and just confuses the user.
    const VALID_ACTION_TYPES = new Set([
      "create_project", "update_project",
      "create_customer", "create_subcontractor",
      "create_quote", "create_invoice",
      "record_payment", "create_change_order",
      "save_project_file", "create_todo",
      "schedule_event", "link_email_to_project",
      "draft_reply", "skip",
    ]);
    proposed_actions = proposed_actions.filter((a) =>
      VALID_ACTION_TYPES.has(a.type),
    );

    // ── Save assistant message ───────────────────────────────
    let assistantMessageId: string | null = null;
    if (conversationId) {
      const { data: savedMsg } = await supabase
        .from("conversation_messages")
        .insert({
          conversation_id: conversationId,
          role: "assistant",
          content: message,
          source: "text",
          metadata: {
            proposed_actions: proposed_actions.map((a) => ({
              ...a,
              status: "pending",
            })),
          },
        })
        .select("id")
        .single();
      assistantMessageId = savedMsg?.id || null;

      // Update conversation timestamp
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);
    }

    return NextResponse.json({
      message,
      proposed_actions,
      conversationId,
      assistantMessageId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("API key") || msg.includes("authentication")) {
      return NextResponse.json(
        {
          error:
            "No Anthropic API key found. Add ANTHROPIC_API_KEY to .env.local or go to Settings.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── Extract content from Google Docs/Sheets/Drive links in email body ──

const DRIVE_API = "https://www.googleapis.com/drive/v3";

const DRIVE_PATTERNS = [
  /https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/g,
  /https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/g,
  /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/g,
  /https?:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/g,
];

async function extractDriveContent(
  body: string
): Promise<{ name: string; type: string; text: string }[]> {
  const results: { name: string; type: string; text: string }[] = [];
  const seenIds = new Set<string>();

  for (const pattern of DRIVE_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(body)) !== null) {
      const fileId = match[1];
      if (seenIds.has(fileId)) continue;
      seenIds.add(fileId);

      try {
        // Get file metadata
        const metaRes = await googleFetch(
          `${DRIVE_API}/files/${fileId}?fields=name,mimeType&supportsAllDrives=true`
        );
        if (!metaRes.ok) continue;
        const meta = await metaRes.json();
        const gMime = meta.mimeType as string;
        const name = (meta.name as string) || fileId;

        let text = "";

        if (gMime === "application/vnd.google-apps.document") {
          // Export Google Doc as plain text
          const res = await googleFetch(
            `${DRIVE_API}/files/${fileId}/export?mimeType=text/plain`
          );
          if (res.ok) text = await res.text();
        } else if (gMime === "application/vnd.google-apps.spreadsheet") {
          // Export Google Sheet as CSV (readable text)
          const res = await googleFetch(
            `${DRIVE_API}/files/${fileId}/export?mimeType=text/csv`
          );
          if (res.ok) text = await res.text();
        } else if (gMime === "application/vnd.google-apps.presentation") {
          // Export Google Slides as plain text
          const res = await googleFetch(
            `${DRIVE_API}/files/${fileId}/export?mimeType=text/plain`
          );
          if (res.ok) text = await res.text();
        }

        if (text.trim()) {
          const typeLabel =
            gMime === "application/vnd.google-apps.document" ? "Google Doc" :
            gMime === "application/vnd.google-apps.spreadsheet" ? "Google Sheet" :
            gMime === "application/vnd.google-apps.presentation" ? "Google Slides" :
            "Drive File";

          results.push({ name, type: typeLabel, text: text.substring(0, 50000) });
        }
      } catch {
        // Skip this file — may not have access
      }
    }
  }

  return results;
}
