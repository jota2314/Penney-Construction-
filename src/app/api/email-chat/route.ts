import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleFetch } from "@/lib/google/auth";
import {
  getAnthropicClient,
  CLAUDE_MODEL,
  CLAUDE_FALLBACK_MODELS,
  nowStamp,
} from "@/lib/ai/claude";
import {
  extractAttachmentText,
  type AttachmentMeta,
} from "@/lib/actions/extract-attachment";

const AUTO_ANALYZE_PROMPT = `Analyze this email and DO EVERYTHING it needs — don't just describe it, take action. For every email:
1. Create/link the project if it's a real job
2. Create customers and subs from the email
3. Save any quotes, invoices, or files attached
4. Create todos for any follow-up work needed (with the right category: quotes, estimates, scheduling, follow_up_quotes, follow_up_clients, permits_inspections, materials, change_orders, payments, contracts_docs)
5. Draft a reply email if one is needed — most business emails need a response
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

    const currentUser = userName || "Jorge";

    const systemPrompt = `You are the AI assistant for Penney Construction, a residential general contractor on the North Shore of Massachusetts.

## CURRENT DATE & TIME: ${nowStamp()}

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
  - trades MUST be a JSON array of strings like ["electrical", "plumbing"], never a comma-separated string
- create_quote: { subcontractor_name, project_name, trade, amount, scope_description, status, document_type, attachment_storage_path, extracted_text }
  - Use for QUOTES, ESTIMATES, and PROPOSALS — documents that say "this is what we'll charge"
  - document_type must be one of: quote, change_order, estimate, permit, contract, other
  - attachment_storage_path: use the EXACT storage_path value from the email attachment metadata (e.g., "19d25b9f870ba662/quote.pdf"), NOT just the filename
  - extracted_text: ALWAYS include the key content extracted from the PDF — total amount, line items with prices, dates, notes
  - amount: ALWAYS extract the total/grand total dollar amount from the PDF content. Never say "amount in attached PDF" — actually parse it.
- create_invoice: { vendor_name, project_name, trade, amount, invoice_number, invoice_date, due_date, terms, description, vendor_type, attachment_storage_path, extracted_text }
  - Use for INVOICES — documents that say "you owe us this" or "cash sales invoice" or "bill"
  - vendor_type: subcontractor, supplier, vendor, or other
  - vendor_name: the company that sent the invoice (e.g., "Building Center of Essex")
  - ALWAYS extract: invoice_number, invoice_date, due_date, terms, total amount, and line items
  - amount: the total dollar amount on the invoice
- save_project_file: { project_name, filename, storage_path, category, mime_type, size, description }
  - Use to save an email attachment as a categorized project file (drawings, specs, pricing docs, etc.)
  - category MUST be one of: construction_drawings, specs, pricing, contracts, permits, photos, invoices, estimates, other
  - Use "construction_drawings" for: plans, blueprints, pricing sets, construction sets, bid sets, architectural drawings
  - Use "specs" for: specifications, guidelines
  - Use "pricing" for: pricing guidelines, rate sheets
  - filename and storage_path: use the EXACT values from the email attachment metadata
  - description: brief note about the file content
- create_todo: { contact_name, description, priority, project_name, category, due_date }
  - category MUST be one of: quotes, estimates, scheduling, follow_up_quotes, follow_up_clients, permits_inspections, materials, change_orders, payments, contracts_docs, general
  - Pick the right category based on the todo content (e.g., "get quote from sub" = quotes, "follow up on quote" = follow_up_quotes, "schedule walkthrough" = scheduling)
  - due_date: ISO date string if a deadline is mentioned or implied
- schedule_event: { name, project_name, start_datetime, end_datetime, description, event_type, location }
  - Use when an email discusses scheduling a meeting, walkthrough, inspection, or any calendar event
  - name: descriptive like "Walkthrough: ClientName - ProjectName" or "Site Meeting: ProjectName"
  - event_type: must be one of: meeting, walkthrough, inspection, phase
  - start_datetime / end_datetime: ISO 8601 with timezone (e.g., "2026-04-02T10:00:00-04:00"). Default end = 1 hour after start
  - location: physical address for in-person events
  - Saves event to the app schedule. User can manually sync to Google Calendar or add Google Meet later
- link_email_to_project: { project_name }
- draft_reply: { to_email, to_name, subject, body, cc, attachment_paths }
  - attachment_paths: optional array of storage_path strings from the email's attachments to include as email attachments
  - When forwarding quotes, PDFs, or documents, include the relevant attachment_paths so the file gets attached to the outgoing email
  - cc: optional comma-separated email addresses for CC recipients
  - When replying to a thread with multiple people, put the primary recipient in to_email and others in cc
  - IMPORTANT: Keep recipients separated — if drafting TWO different emails to TWO different people, create TWO separate draft_reply actions (don't put both in one email)
  - THREADING RULES:
    - Reply to the original sender → stays in the same email thread automatically
    - Email to a DIFFERENT person (e.g., emailing a sub about a customer's request) → starts a NEW thread automatically. The customer will NOT see it.
    - Label clearly: "Reply to Paul Guthrow" vs "Email to Chris Parello at Jackson Lumber" so the user knows which is a reply and which is a new email
    - NEVER include the customer in CC when emailing subs about pricing/specs — that's confidential GC workflow
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

## BE PROACTIVE — DO EVERYTHING IN ONE SHOT
When you analyze an email, don't just describe it — take ALL the actions it needs immediately. The user should just have to click "approve", not ask you to do things one by one.

For EVERY email, ask yourself these questions and act on ALL that apply:
1. **Does this email need a reply?** → Include a draft_reply. Most business emails need responses — quotes need "thank you, reviewing", client questions need answers, sub inquiries need follow-ups, scheduling requests need confirmations.
2. **Does this create follow-up work?** → Include create_todo with the right category. Examples:
   - Got a quote → todo: "Review quote from [sub]" (category: quotes)
   - Client asking for estimate → todo: "Prepare estimate for [project]" (category: estimates)
   - Need to schedule something → todo: "Schedule [event] for [project]" (category: scheduling)
   - Sent a quote, no response → todo: "Follow up with [sub] on quote" (category: follow_up_quotes)
   - Waiting on client decision → todo: "Follow up with [client] on proposal" (category: follow_up_clients)
   - Need permits → todo: "Pull permit for [project]" (category: permits_inspections)
   - Need materials ordered → todo: "Order [materials] for [project]" (category: materials)
   - Change order discussion → todo: "Process change order for [project]" (category: change_orders)
   - Invoice received → todo: "Process payment for [vendor]" (category: payments)
   - Need signed docs → todo: "Get signed contract from [client]" (category: contracts_docs)
3. **Is there a project to create or link?** → Include create_project / link_email_to_project
4. **Is there a customer or sub to create?** → Include create_customer / create_subcontractor
5. **Are there quotes, invoices, or files to save?** → Include create_quote / create_invoice / save_project_file

**ALWAYS propose multiple actions.** A typical email should generate 3-5 actions (link to project + create todo + draft reply + save quote, etc.). If you're only proposing 1-2 actions, you're probably missing something.

**Draft replies should be READY TO SEND** — full professional email with greeting, body, signature. Not a template or placeholder.

## EMAIL STYLE — MANDATORY FOR ALL draft_reply EMAILS
- Keep emails SHORT. 3-5 sentences. Construction people are busy — get to the point.
- Be friendly and warm but brief. "Hope you're doing well!" is fine. Two paragraphs of pleasantries is not.
- NO long thank-you paragraphs. NO restating what they already know at length.
- Sign ONLY as:
Jorge Betancur
Penney Construction Inc.
617-596-2476
- Do NOT add any other signature after that. The system adds the company logo automatically.

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
- If the email is spam, a newsletter, automated notification, or purely internal with no project context → propose skip and say why${
      currentDraft
        ? `

## ACTIVE DRAFT REPLY — USER IS EDITING
The user is currently editing a draft email reply. Here is the current state:
To: ${currentDraft.to || ""}
CC: ${currentDraft.cc || ""}
Subject: ${currentDraft.subject || ""}
Body:
${currentDraft.body || ""}

When the user asks you to modify the draft, return an UPDATED draft_reply action with the FULL revised content (not just the changed parts). Their editor will update automatically. Focus on refining this specific email based on their feedback.`
        : ""
    }`;

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
          max_tokens: 4096,
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
