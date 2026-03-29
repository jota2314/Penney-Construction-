import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getAnthropicClient,
  CLAUDE_MODEL,
  CLAUDE_FALLBACK_MODELS,
} from "@/lib/ai/claude";
import {
  extractAttachmentText,
  type AttachmentMeta,
} from "@/lib/actions/extract-attachment";

const AUTO_ANALYZE_PROMPT = `Analyze this email and tell me what to do with it. We're in setup mode — building the company database from scratch by going through historical emails. If this looks like a real construction project, suggest creating it. If it's spam or internal, say skip.`;

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
    } = await request.json();

    if (!emailId)
      return NextResponse.json(
        { error: "emailId required" },
        { status: 400 }
      );

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

    // Save user message to conversation (skip for auto-analyze)
    if (!autoAnalyze && conversationId) {
      await supabase.from("conversation_messages").insert({
        conversation_id: conversationId,
        role: "user",
        content: actualUserMessage,
        source: "text",
      });
    }

    // ── Load DB context ──────────────────────────────────────
    const [{ data: projects }, { data: customers }, { data: subs }] =
      await Promise.all([
        supabase
          .from("projects")
          .select(
            "id, name, address, city, status, project_type, customer_id"
          ),
        supabase
          .from("customers")
          .select("id, first_name, last_name, email"),
        supabase
          .from("subcontractors")
          .select("id, company_name, contact_name, email"),
      ]);

    const projectList =
      (projects ?? [])
        .map(
          (p) =>
            `- "${p.name}" [${p.status}] ${p.address || ""} ${p.city || ""}`.trim()
        )
        .join("\n") || "No projects yet — database is empty, we're setting up";

    const customerList =
      (customers ?? [])
        .map(
          (c) =>
            `- ${c.first_name} ${c.last_name}${c.email ? ` <${c.email}>` : ""}`
        )
        .join("\n") || "None yet";

    const subList =
      (subs ?? [])
        .map(
          (s) =>
            `- ${s.company_name}${s.contact_name ? ` (${s.contact_name})` : ""}${s.email ? ` <${s.email}>` : ""}`
        )
        .join("\n") || "None yet";

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

    const attachmentInfo =
      attachments.length > 0
        ? `Attachments:\n${attachments
            .map((a) => {
              let info = `- ${a.filename} (${a.mimeType})`;
              if (a.text_content) {
                info += `\n  Content:\n${a.text_content.substring(0, 8000)}`;
              }
              return info;
            })
            .join("\n")}`
        : "No attachments";

    const currentUser = userName || "Jorge";

    const systemPrompt = `You are the AI assistant for Penney Construction, a residential general contractor on the North Shore of Massachusetts.

You are currently assisting **${currentUser}**. When drafting email replies, sign them as "${currentUser}" (not Ryan, not anyone else — always ${currentUser}).

Team (NOT customers — never create these as customers): Ryan Penney (Owner), Jorge Betancur (Estimator), Nicole Smith (Admin), Howie Clickstein (Field), Shannon Penney (Intake).

## CURRENT MODE: SETUP
The company database is being built from scratch by going through historical emails. Most projects DON'T exist yet.
- Be aggressive about suggesting new projects — if it references a real construction job, suggest creating it
- Missing info is OK — it gets filled in from later emails
- Project names: "LastName ProjectType" (e.g., "Gouthro Addition", "Colten Kitchen", "Schenkel Renovation")
- Every real job gets a project. Better to create one and merge later than to miss it.

## THE EMAIL
Subject: ${email.subject}
From: ${email.from_name} <${email.from_email}>
To: ${email.to_name} <${email.to_email}>
Date: ${email.date}
Direction: ${email.direction}
${attachmentInfo}

Body:
${(email.body || email.snippet || "").substring(0, 4000)}

## EXISTING DATABASE
Projects:
${projectList}

Customers:
${customerList}

Subcontractors:
${subList}

## ACTIONS YOU CAN PROPOSE
- create_project: { name, address, city, state, project_type, status, description, customer_name, estimated_value, scope_of_work, required_trades }
- update_project: { project_name, address, city, state, description, estimated_value, contract_value, scope_of_work, status, phase }
- create_customer: { first_name, last_name, email, phone, address, city, state }
- create_subcontractor: { company_name, contact_name, email, phone, trades }
- create_quote: { subcontractor_name, project_name, trade, amount, scope_description, status, document_type, attachment_storage_path, extracted_text }
  - document_type must be one of: quote, invoice, change_order, estimate, permit, contract, other
  - attachment_storage_path: if a specific attachment is being logged as a quote, include its storage_path so the file is linked directly to the quote record
  - extracted_text: ALWAYS include the key content extracted from the PDF — total amount, line items with prices, dates, notes. This gets stored on the quote record so users can see details without opening the PDF.
  - amount: ALWAYS extract the total/grand total dollar amount from the PDF content. Read the attachment text carefully for totals. Never say "amount in attached PDF" — actually parse it.
- create_follow_up: { contact_name, description, priority, project_name }
- link_email_to_project: { project_name }
- draft_reply: { to_email, to_name, subject, body }
- skip: {}

## RESPONSE FORMAT — CRITICAL
Your ENTIRE response must be a single JSON object. No text before or after. No markdown fences. No explanation outside the JSON.
Put ALL your conversational text inside the "message" field:
{
  "message": "Your conversational response goes here — all of it, including explanations",
  "proposed_actions": [
    { "type": "action_type", "label": "Short description", "data": { ... } }
  ]
}

Return proposed_actions: [] when no actions needed.

## RULES
- Think like a GC: trades, sub quotes, client proposals, project lifecycle
- Project names: "LastName ProjectType" — extract the client's last name and the type of work
- Extract EVERYTHING: addresses, phones, emails from signatures, dollar amounts
- When creating a project, ALSO create_customer if a homeowner is identifiable
- When a project is created or identified, ALSO include link_email_to_project
- NEVER fabricate data — only use what's in the email
- Be concise and direct — say what this email is and what you suggest
- Status options (MUST be one of): lead, estimating, proposal_sent, contracted, in_progress, completed, cancelled
- project_type options (MUST be one of): remodel, addition, kitchen, bathroom, new_construction, other — NOTE: there is no "renovation", use "remodel" instead
- Default state: MA
- If the email is spam, a newsletter, automated notification, or purely internal with no project context → propose skip and say why`;

    // ── Build Claude messages ────────────────────────────────
    const claudeMessages: { role: "user" | "assistant"; content: string }[] =
      [];
    if (clientMessages && Array.isArray(clientMessages)) {
      for (const msg of clientMessages.slice(-20)) {
        claudeMessages.push({ role: msg.role, content: msg.content });
      }
    }
    claudeMessages.push({ role: "user", content: actualUserMessage });

    // ── Call Claude ──────────────────────────────────────────
    const anthropic = await getAnthropicClient();
    let rawContent = "";

    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: 2048,
          system: systemPrompt,
          messages: claudeMessages,
        });
        rawContent =
          response.content[0]?.type === "text"
            ? response.content[0].text.trim()
            : "";
        if (rawContent) break;
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
    let message: string;
    let proposed_actions: {
      type: string;
      label: string;
      data: Record<string, unknown>;
    }[] = [];

    const jsonStart = rawContent.indexOf("{");
    const jsonEnd = rawContent.lastIndexOf("}");

    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      const jsonStr = rawContent.substring(jsonStart, jsonEnd + 1);
      try {
        const parsed = JSON.parse(jsonStr);
        message = parsed.message || "I couldn't process that.";
        proposed_actions = parsed.proposed_actions || [];
      } catch {
        // JSON extraction failed — use raw text
        message = rawContent
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
      }
    } else {
      message = rawContent;
    }

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
