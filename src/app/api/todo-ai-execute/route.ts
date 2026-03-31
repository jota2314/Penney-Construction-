import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getAnthropicClient,
  CLAUDE_FALLBACK_MODELS,
  nowStamp,
} from "@/lib/ai/claude";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { todoId, action, messages: chatHistory } = await request.json();

    if (!todoId)
      return NextResponse.json(
        { error: "todoId required" },
        { status: 400 }
      );

    // "chat" action = follow-up message in existing conversation
    // other actions = initial AI action (draft_email, summarize, suggest_next)
    const isChat = action === "chat";
    const initialAction = isChat ? null : action;

    if (!isChat && !action)
      return NextResponse.json(
        { error: "action required" },
        { status: 400 }
      );

    // Load the todo
    const { data: todo } = await supabase
      .from("todos")
      .select("*")
      .eq("id", todoId)
      .single();

    if (!todo)
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });

    // Load related context
    const [projectRes, emailsRes, quotesRes, todosRes, employeesRes, subsRes, customersRes] = await Promise.all([
      todo.project_id
        ? supabase
            .from("projects")
            .select(
              "id, name, address, city, status, project_type, scope_of_work, estimated_value, contract_value, required_trades, phase"
            )
            .eq("id", todo.project_id)
            .single()
        : Promise.resolve({ data: null }),
      todo.project_id
        ? supabase
            .from("inbox_emails")
            .select("subject, from_name, from_email, snippet, date, direction")
            .eq("project_id", todo.project_id)
            .order("date", { ascending: false })
            .limit(10)
        : supabase
            .from("inbox_emails")
            .select("subject, from_name, from_email, snippet, date, direction")
            .or(
              `from_name.ilike.%${todo.contact_name}%,from_email.ilike.%${todo.contact_name}%`
            )
            .order("date", { ascending: false })
            .limit(10),
      todo.project_id
        ? supabase
            .from("quote_requests")
            .select(
              "subcontractor_name, trade, amount, status, scope_description, sent_at"
            )
            .eq("project_id", todo.project_id)
            .order("sent_at", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),
      todo.project_id
        ? supabase
            .from("todos")
            .select("contact_name, description, priority, category, due_date")
            .eq("project_id", todo.project_id)
            .eq("status", "open")
            .neq("id", todoId)
            .limit(10)
        : Promise.resolve({ data: [] }),
      // Active employees
      supabase
        .from("employees")
        .select("id, first_name, last_name, title, phone, email, hourly_rate")
        .eq("status", "active")
        .order("last_name"),
      // Subcontractors with emails
      supabase
        .from("subcontractors")
        .select("id, company_name, contact_name, email, phone, trades")
        .eq("is_active", true)
        .order("company_name"),
      // Customers with emails
      supabase
        .from("customers")
        .select("id, first_name, last_name, email, phone")
        .order("last_name"),
    ]);

    const project = projectRes.data;
    const emails = emailsRes.data ?? [];
    const quotes = quotesRes.data ?? [];
    const relatedTodos = todosRes.data ?? [];
    const employees = employeesRes.data ?? [];
    const subs = subsRes.data ?? [];
    const customers = customersRes.data ?? [];

    // Build context strings
    const projectContext = project
      ? `Project: ${project.name} [${project.status}]
Address: ${project.address || "N/A"}, ${project.city || ""}
Type: ${project.project_type} | Phase: ${project.phase || "N/A"}
Scope: ${project.scope_of_work || "N/A"}
Est. Value: ${project.estimated_value ? `$${project.estimated_value.toLocaleString()}` : "N/A"}
Contract: ${project.contract_value ? `$${project.contract_value.toLocaleString()}` : "N/A"}
Trades: ${project.required_trades ? JSON.stringify(project.required_trades) : "N/A"}`
      : "No linked project";

    const emailContext =
      emails.length > 0
        ? emails
            .map(
              (e) =>
                `- [${e.direction}] ${e.date?.split("T")[0] || "?"} | ${e.from_name} <${e.from_email}> | ${e.subject}\n  ${(e.snippet || "").substring(0, 200)}`
            )
            .join("\n")
        : "No related emails found";

    const quoteContext =
      quotes.length > 0
        ? quotes
            .map(
              (q) =>
                `- ${q.subcontractor_name} | ${q.trade || "?"} | $${q.amount || "?"} | ${q.status} | ${q.scope_description || ""}`
            )
            .join("\n")
        : "No quotes";

    const relatedTodosContext =
      relatedTodos.length > 0
        ? relatedTodos
            .map(
              (t) =>
                `- [${t.category}/${t.priority}] ${t.contact_name}: ${t.description}${t.due_date ? ` (due ${t.due_date.split("T")[0]})` : ""}`
            )
            .join("\n")
        : "No other open todos";

    const CATEGORY_LABELS: Record<string, string> = {
      quotes: "Quotes",
      estimates: "Estimates",
      scheduling: "Scheduling",
      follow_up_quotes: "Follow-up (Quotes)",
      follow_up_clients: "Follow-up (Clients)",
      permits_inspections: "Permits & Inspections",
      materials: "Materials & Procurement",
      change_orders: "Change Orders",
      payments: "Payments",
      contracts_docs: "Contracts & Docs",
      general: "General",
    };

    const employeesContext =
      employees.length > 0
        ? employees
            .map(
              (e) =>
                `- ${e.first_name} ${e.last_name} | ${e.title} | $${e.hourly_rate}/hr${e.phone ? ` | ${e.phone}` : ""}${e.email ? ` | ${e.email}` : ""} | ID: ${e.id}`
            )
            .join("\n")
        : "No employees in database";

    // Build a full contact directory for email lookups
    const contactDirectory: string[] = [];

    // Team members (office)
    contactDirectory.push("OFFICE TEAM:");
    contactDirectory.push("- Ryan Penney (Owner) | rpenney@penneyconstructioninc.com");
    contactDirectory.push("- Jorge Betancur (Estimator) | jbetancur@penneyconstructioninc.com");
    contactDirectory.push("- Nicole Smith (Admin) | nsmith@penneyconstructioninc.com");

    // Employees (field crew)
    if (employees.length > 0) {
      contactDirectory.push("\nFIELD CREW:");
      employees.forEach((e) => {
        contactDirectory.push(
          `- ${e.first_name} ${e.last_name} (${e.title})${e.email ? ` | ${e.email}` : ""}${e.phone ? ` | ${e.phone}` : ""}`
        );
      });
    }

    // Subcontractors
    if (subs.length > 0) {
      contactDirectory.push("\nSUBCONTRACTORS:");
      subs.forEach((s) => {
        const trades = Array.isArray(s.trades) ? s.trades.join(", ") : "";
        contactDirectory.push(
          `- ${s.company_name}${s.contact_name ? ` (${s.contact_name})` : ""}${s.email ? ` | ${s.email}` : ""}${s.phone ? ` | ${s.phone}` : ""}${trades ? ` | ${trades}` : ""}`
        );
      });
    }

    // Customers
    if (customers.length > 0) {
      contactDirectory.push("\nCLIENTS:");
      customers.forEach((c) => {
        contactDirectory.push(
          `- ${c.first_name} ${c.last_name}${c.email ? ` | ${c.email}` : ""}${c.phone ? ` | ${c.phone}` : ""}`
        );
      });
    }

    const contactsContext = contactDirectory.join("\n");

    const todoSummary = `Todo: ${todo.description}
Contact: ${todo.contact_name} (${todo.contact_type})
Category: ${CATEGORY_LABELS[todo.category] || todo.category}
Priority: ${todo.priority}
Due: ${todo.due_date ? todo.due_date.split("T")[0] : "No due date"}
Created: ${todo.created_at.split("T")[0]}`;

    // ── Build system prompt ──────────────────────────────────
    const systemPrompt = `You are the AI assistant for Penney Construction, a residential GC on the North Shore of Massachusetts.
Current date: ${nowStamp()}

You're helping ${user.email || "Jorge"} work through a todo item. Be conversational, helpful, and action-oriented. Think like a GC office manager who knows construction.

## TODO
${todoSummary}

## PROJECT CONTEXT
${projectContext}

## RELATED EMAILS (recent history)
${emailContext}

## QUOTES
${quoteContext}

## OTHER OPEN TODOS FOR THIS PROJECT
${relatedTodosContext}

## CREW (available employees)
${employeesContext}

## CONTACT DIRECTORY — USE THIS TO LOOK UP EMAILS
${contactsContext}

## WHAT YOU CAN DO
You can help with anything related to this todo:
- Draft or revise emails (professional, construction industry tone, sign as "Jorge") — user can SEND them with one click
- Schedule meetings on Google Calendar with optional Google Meet link
- Assign crew members to projects/phases
- Summarize context and history
- Suggest next steps and create new todos
- Answer questions about the project, contacts, quotes, timeline
- Help with wording, pricing strategy, negotiation approach
- Help prioritize and plan

## RESPONSE FORMAT — CRITICAL
Your ENTIRE response must be a single JSON object. No text before or after. No markdown fences.

{
  "message": "Your conversational response — be helpful and specific",
  "draft_email": { "to_email": "recipient@email.com", "to_name": "Recipient Name", "cc": "person1@email.com, person2@email.com", "subject": "Email subject line", "body": "Full email body text" },
  "schedule_meeting": { "name": "Meeting name", "start_time": "ISO datetime", "end_time": "ISO datetime", "location": "Address", "description": "Details", "attendees": ["email@..."], "with_meet_link": true },
  "assign_workers": { "employee_ids": ["uuid", ...], "employee_names": ["Name", ...], "phase_name": "Phase description", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" },
  "new_todos": [{ "description": "...", "contact_name": "...", "category": "...", "priority": "medium" }]
}

CRITICAL RULES:
- When drafting an email, you MUST include the "draft_email" object with to_email, to_name, cc, subject, and body fields. Do NOT put the email in the "message" field — put it in "draft_email".
- The "body" field in draft_email should contain the FULL email text (greeting, content, signature). Use \\n for line breaks.
- The "message" field should contain a SHORT explanation of what you drafted and why.
- AUTO-CC: When you mention someone in the email body (e.g., "I've spoken with Eric from DL Services"), ALWAYS look up their email in the CONTACT DIRECTORY and add them to the "cc" field. If the user asks to include Ryan, Eric, Nicole, etc., find their email and CC them. If you can't find their email, say so in the message.
- LOOK UP EMAILS: Always use the Contact Directory to find real email addresses. Never make up email addresses. If someone's email is in the directory, use it. If not, leave the field for the user to fill in.
- ALL fields except "message" are OPTIONAL — only include what's relevant.
- When scheduling, use ISO 8601 with timezone (America/New_York, UTC-4).
- Categories for new_todos: quotes, estimates, scheduling, follow_up_quotes, follow_up_clients, permits_inspections, materials, change_orders, payments, contracts_docs, general`;

    // ── Build messages ──────────────────────────────────────
    const claudeMessages: { role: "user" | "assistant"; content: string }[] = [];

    if (chatHistory && Array.isArray(chatHistory)) {
      // Existing conversation — replay the history
      for (const msg of chatHistory.slice(-20)) {
        claudeMessages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    } else if (initialAction) {
      // First message — use the action as the prompt
      const actionPrompts: Record<string, string> = {
        draft_email: `Draft a professional email to handle this todo: "${todo.description}" for ${todo.contact_name}. Make it ready to send.`,
        summarize: `Give me the full picture on this todo. Summarize all the context — what happened, where things stand, what's pending. Include a timeline and key facts.`,
        suggest_next: `What should I do next for this todo? Be specific and actionable. If there are new todos to create, suggest them.`,
      };
      claudeMessages.push({
        role: "user",
        content: actionPrompts[initialAction] || initialAction,
      });
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
        { error: "All Claude models failed" },
        { status: 500 }
      );
    }

    // ── Parse response ──────────────────────────────────────
    let result: Record<string, unknown> = {};
    let cleaned = rawContent
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed = false;

    // Try direct parse
    try {
      const obj = JSON.parse(cleaned);
      if (obj && typeof obj.message === "string") {
        result = obj;
        parsed = true;
      }
    } catch {
      // fallback
    }

    // Try extracting JSON
    if (!parsed) {
      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        try {
          const obj = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
          if (obj && typeof obj.message === "string") {
            result = obj;
            parsed = true;
          }
        } catch {
          // fallback
        }
      }
    }

    // Final fallback — treat raw text as message
    if (!parsed) {
      result = { message: cleaned };
    }

    // Fallback: if action was draft_email but draft_email field is missing,
    // try to extract email from the message text
    if (
      (initialAction === "draft_email" || action === "chat") &&
      !result.draft_email &&
      typeof result.message === "string"
    ) {
      const msg = result.message as string;
      // Look for email-like patterns in the message
      const subjectMatch = msg.match(/Subject:\s*(.+?)(?:\n|\\n)/i);
      const toMatch = msg.match(/To:\s*(.+?)(?:\n|\\n)/i);
      // If the message contains what looks like an email body (greeting + signature)
      const hasGreeting = /^(Hi|Hello|Dear|Hey)\s/im.test(msg);
      const hasSignature = /(Jorge|Best|Thanks|Regards)/im.test(msg);

      if ((subjectMatch || toMatch) && (hasGreeting || hasSignature)) {
        // Extract the email body — everything that looks like email content
        let emailBody = msg;
        // Remove any "Here's a draft..." preamble
        emailBody = emailBody.replace(
          /^.*?(?:here'?s?|I'?ve? drafted|draft(?:ed)?|below).*?(?:\n|\\n)+/i,
          ""
        );

        const toEmail = toMatch
          ? toMatch[1].replace(/<|>/g, "").trim()
          : todo.contact_name;

        result.draft_email = {
          to_email: toEmail,
          to_name: todo.contact_name,
          subject:
            subjectMatch?.[1]?.trim() ||
            `Re: ${todo.description.substring(0, 60)}`,
          body: emailBody.replace(/\\n/g, "\n").trim(),
        };
        // Shorten the message since the email is now in draft_email
        result.message =
          "Here's a draft email for this todo. You can edit any field before sending.";
      }
    }

    // Save AI summary if one was generated
    if (initialAction === "summarize" && result.message) {
      await supabase
        .from("todos")
        .update({
          ai_summary: (result.message as string).substring(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", todoId);
    }

    return NextResponse.json({
      action: action || "chat",
      todoId,
      result,
      // Echo back the assistant message content for chat history
      assistantMessage: result.message || cleaned,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
