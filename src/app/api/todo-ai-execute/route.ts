import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { todoId, action } = await request.json();

    if (!todoId || !action)
      return NextResponse.json(
        { error: "todoId and action required" },
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
    const [projectRes, emailsRes, quotesRes, todosRes] = await Promise.all([
      // Project info if linked
      todo.project_id
        ? supabase
            .from("projects")
            .select(
              "id, name, address, city, status, project_type, scope_of_work, estimated_value, contract_value, required_trades, phase"
            )
            .eq("id", todo.project_id)
            .single()
        : Promise.resolve({ data: null }),
      // Related emails (by project or contact name)
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
      // Related quotes
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
      // Other open todos for same project
      todo.project_id
        ? supabase
            .from("todos")
            .select("contact_name, description, priority, category, due_date")
            .eq("project_id", todo.project_id)
            .eq("status", "open")
            .neq("id", todoId)
            .limit(10)
        : Promise.resolve({ data: [] }),
    ]);

    const project = projectRes.data;
    const emails = emailsRes.data ?? [];
    const quotes = quotesRes.data ?? [];
    const relatedTodos = todosRes.data ?? [];

    // Build context
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

    const todoSummary = `Todo: ${todo.description}
Contact: ${todo.contact_name} (${todo.contact_type})
Category: ${CATEGORY_LABELS[todo.category] || todo.category}
Priority: ${todo.priority}
Due: ${todo.due_date ? todo.due_date.split("T")[0] : "No due date"}
Created: ${todo.created_at.split("T")[0]}`;

    let systemPrompt = "";
    let userPrompt = "";

    if (action === "draft_email") {
      systemPrompt = `You are the AI assistant for Penney Construction, a residential GC on the North Shore of Massachusetts.
Current date: ${nowStamp()}

Your task: Draft a professional email for this todo item. The email should be:
- Professional but friendly (construction industry tone)
- Concise and action-oriented
- Signed as "Jorge" (Jorge Betancur, Estimator at Penney Construction)

## TODO
${todoSummary}

## PROJECT CONTEXT
${projectContext}

## RELATED EMAILS (recent history)
${emailContext}

## QUOTES
${quoteContext}

## RESPONSE FORMAT
Return a JSON object:
{
  "to_email": "recipient@email.com",
  "to_name": "Recipient Name",
  "subject": "Email subject",
  "body": "Full email body with proper greeting and signature",
  "reasoning": "Brief explanation of why you drafted it this way"
}

If you can't determine the recipient email from context, use "UNKNOWN" for to_email and explain in reasoning.`;

      userPrompt = `Draft an email to handle this todo: "${todo.description}" for ${todo.contact_name}`;
    } else if (action === "summarize") {
      systemPrompt = `You are the AI assistant for Penney Construction. Summarize all context around this todo item so the user has the full picture at a glance.

Current date: ${nowStamp()}

## TODO
${todoSummary}

## PROJECT CONTEXT
${projectContext}

## RELATED EMAILS
${emailContext}

## QUOTES
${quoteContext}

## OTHER OPEN TODOS
${relatedTodosContext}

## RESPONSE FORMAT
Return a JSON object:
{
  "summary": "2-4 sentence summary of the full context — what happened, where things stand, what's pending",
  "key_facts": ["fact 1", "fact 2", ...],
  "timeline": [{"date": "YYYY-MM-DD", "event": "description"}, ...]
}`;

      userPrompt = `Summarize the full context for this todo: "${todo.description}"`;
    } else if (action === "suggest_next") {
      systemPrompt = `You are the AI assistant for Penney Construction. Based on this todo and its context, suggest what should happen next.

Current date: ${nowStamp()}

## TODO
${todoSummary}

## PROJECT CONTEXT
${projectContext}

## RELATED EMAILS
${emailContext}

## QUOTES
${quoteContext}

## OTHER OPEN TODOS
${relatedTodosContext}

## RESPONSE FORMAT
Return a JSON object:
{
  "suggestion": "What to do next — be specific and actionable",
  "new_todos": [
    {"description": "...", "contact_name": "...", "category": "...", "priority": "medium", "due_date": "YYYY-MM-DD or null"}
  ],
  "reasoning": "Why this is the right next step"
}

Categories: quotes, estimates, scheduling, follow_up_quotes, follow_up_clients, permits_inspections, materials, change_orders, payments, contracts_docs, general
Priorities: low, medium, high, urgent`;

      userPrompt = `What should happen next for this todo: "${todo.description}" for ${todo.contact_name}?`;
    } else {
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      );
    }

    const rawResponse = await callClaude(systemPrompt, userPrompt, 2048);

    // Parse JSON response
    let result: Record<string, unknown> = {};
    try {
      const cleaned = rawResponse
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        result = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
      }
    } catch {
      result = { raw: rawResponse };
    }

    // Save AI summary to the todo if action was summarize
    if (action === "summarize" && result.summary) {
      await supabase
        .from("todos")
        .update({
          ai_summary: result.summary as string,
          updated_at: new Date().toISOString(),
        })
        .eq("id", todoId);
    }

    return NextResponse.json({ action, todoId, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
