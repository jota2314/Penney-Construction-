import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { emailId, messages, userMessage } = await request.json();
    if (!emailId || !userMessage) {
      return NextResponse.json(
        { error: "emailId and userMessage required" },
        { status: 400 }
      );
    }

    // Load email from Supabase (not Gmail — already stored)
    const { data: email } = await supabase
      .from("inbox_emails")
      .select("*")
      .eq("id", emailId)
      .single();

    if (!email)
      return NextResponse.json({ error: "Email not found" }, { status: 404 });

    // Load current DB state for context
    const [{ data: projects }, { data: customers }, { data: subs }] =
      await Promise.all([
        supabase
          .from("projects")
          .select("id, name, address, city, status, project_type, customer_id"),
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
        .join("\n") || "No projects yet";

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

    const attachmentInfo =
      email.attachments && email.attachments.length > 0
        ? `Attachments:\n${email.attachments.map((a: { filename: string; mimeType: string }) => `- ${a.filename} (${a.mimeType})`).join("\n")}`
        : "No attachments";

    const systemPrompt = `You are the AI assistant for Penney Construction, a residential general contractor on the North Shore of Massachusetts.

Team (NOT customers): Ryan Penney (Owner), Jorge Betancur (Estimator), Nicole Smith (Admin), Howie Clickstein (Field), Shannon Penney (Intake).

You're helping Jorge triage an email. Here is the email:

## EMAIL
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
When the user asks you to take action, propose structured actions. Types:
- create_project: { name, address, city, state, project_type, status, description, customer_name, estimated_value, scope_of_work, required_trades }
- update_project: { project_name, address, city, state, description, estimated_value, contract_value, scope_of_work, status, phase }
- create_customer: { first_name, last_name, email, phone, address, city, state }
- create_subcontractor: { company_name, contact_name, email, phone, trades }
- create_quote: { subcontractor_name, project_name, trade, amount, scope_description, status }
- create_follow_up: { contact_name, description, priority, project_name }
- link_email_to_project: { project_name }
- draft_reply: { to_email, to_name, subject, body }
- skip: {}

## RESPONSE FORMAT
Always respond with ONLY valid JSON (no markdown fences, no extra text):
{
  "message": "Your conversational response to the user",
  "proposed_actions": [
    { "type": "action_type", "label": "Short human-readable label", "data": { ... } }
  ]
}

Return proposed_actions: [] when just chatting with no actions to propose.

## RULES
- Think like a GC: understand trades, sub quotes, client proposals, project lifecycle
- Project names: "ClientLastName ProjectType" (e.g., "Smith Kitchen", "Gouthro Addition")
- Extract EVERYTHING from the email: addresses, phones, emails from signatures, dollar amounts
- Fill in as much as possible — the user never types data, AI fills everything
- If info is missing, mention what's missing — user may have it from another email
- When creating a project, ALSO create_customer if a homeowner is identifiable
- NEVER fabricate data not in the email
- Be concise and direct
- Status options: lead, estimating, proposal_sent, contracted, in_progress, completed
- project_type options: renovation, addition, new_construction, kitchen, bathroom, deck, roofing, siding, other
- priority options: low, medium, high
- Default state: MA`;

    // Build Claude messages from conversation history
    const claudeMessages: { role: "user" | "assistant"; content: string }[] =
      [];
    if (messages && Array.isArray(messages)) {
      for (const msg of messages.slice(-20)) {
        // Last 20 messages max
        claudeMessages.push({ role: msg.role, content: msg.content });
      }
    }
    claudeMessages.push({ role: "user", content: userMessage });

    // Call Claude with fallback
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

    // Parse JSON response
    const cleaned = rawContent
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      return NextResponse.json({
        message: parsed.message || "I couldn't process that.",
        proposed_actions: parsed.proposed_actions || [],
      });
    } catch {
      // If JSON parsing fails, return raw text as message
      return NextResponse.json({
        message: rawContent,
        proposed_actions: [],
      });
    }
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
