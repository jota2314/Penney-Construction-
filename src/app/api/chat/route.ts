import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";
import { buildChatSystemPrompt, type ChatContext } from "@/lib/ai/chat-system-prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Not authenticated", { status: 401 });
  }

  try {
    const { message, conversationId, projectId, source = "text" } = await request.json();

    if (!message || typeof message !== "string") {
      return new Response("Message is required", { status: 400 });
    }

    // Try to get or create conversation (graceful if table doesn't exist)
    let convId = conversationId || null;
    let conversationHistory: Array<{ role: string; content: string }> = [];

    try {
      if (!convId) {
        const { data: conv } = await supabase
          .from("conversations")
          .insert({
            user_id: user.id,
            project_id: projectId || null,
            title: message.substring(0, 100),
          })
          .select("id")
          .single();

        if (conv) convId = conv.id;
      }

      // Save user message
      if (convId) {
        await supabase.from("conversation_messages").insert({
          conversation_id: convId,
          role: "user",
          content: message,
          source,
        });

        // Load conversation history
        const { data: history } = await supabase
          .from("conversation_messages")
          .select("role, content")
          .eq("conversation_id", convId)
          .order("created_at", { ascending: true })
          .limit(50);

        conversationHistory = history || [];
      }
    } catch {
      // Tables don't exist yet — continue without persistence
      convId = null;
    }

    // If no history from DB, just use the current message
    const messages =
      conversationHistory.length > 0
        ? conversationHistory.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        : [{ role: "user" as const, content: message }];

    // Build context from project/email/quote data
    const context = await buildContext(supabase, projectId);

    // Stream response from Claude
    const anthropic = await getAnthropicClient();
    const systemPrompt = buildChatSystemPrompt(context);

    let stream: ReturnType<typeof anthropic.messages.stream> | null = null;
    let usedModel = "";

    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        stream = anthropic.messages.stream({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages,
        });
        usedModel = model;
        break;
      } catch {
        continue;
      }
    }

    if (!stream) {
      throw new Error("All Claude models failed to initialize");
    }

    // Create a ReadableStream that pipes Claude's tokens to the client
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        let fullResponse = "";

        try {
          // Send conversation ID as first chunk
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "conversation_id", id: convId })}\n\n`)
          );

          // Register text handler BEFORE awaiting — this enables true streaming
          stream!.on("text", (text: string) => {
            fullResponse += text;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "text", content: text })}\n\n`)
            );
          });

          // Wait for the stream to complete
          await stream!.finalMessage();

          // Save assistant message to DB (best-effort)
          if (convId) {
            try {
              await supabase.from("conversation_messages").insert({
                conversation_id: convId,
                role: "assistant",
                content: fullResponse,
                metadata: { model: usedModel },
              });
            } catch {
              // Ignore save errors
            }
          }

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done", conversationId: convId })}\n\n`)
          );
          controller.close();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Stream error";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", message: errMsg })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Build chat context from database for the system prompt.
 */
async function buildContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId?: string
): Promise<ChatContext> {
  const context: ChatContext = {};

  try {
    if (projectId) {
      const { data: project } = await supabase
        .from("projects")
        .select("*, customer:customers(first_name, last_name, email)")
        .eq("id", projectId)
        .single();

      if (project) {
        const customer = Array.isArray(project.customer) ? project.customer[0] : project.customer;
        context.project = {
          id: project.id,
          name: project.name,
          address: project.address,
          city: project.city,
          status: project.status,
          project_type: project.project_type,
          description: project.description,
          scope_of_work: project.scope_of_work,
          required_trades: project.required_trades,
          estimated_value: project.estimated_value,
          contract_value: project.contract_value,
          customer_name: customer ? `${customer.first_name} ${customer.last_name}` : null,
          customer_email: customer?.email || null,
        };

        // Get project-specific quotes
        const { data: quotes } = await supabase
          .from("quote_requests")
          .select("subcontractor_name, trade, amount, status")
          .eq("project_name", project.name)
          .limit(20);

        if (quotes && quotes.length > 0) {
          context.openQuotes = quotes;
        }

        // Get project-specific todos
        const { data: todos } = await supabase
          .from("todos")
          .select("contact_name, description, priority, due_date")
          .eq("project_name", project.name)
          .eq("status", "open")
          .limit(20);

        if (todos && todos.length > 0) {
          context.openTodos = todos;
        }

        // Get project-specific emails
        const { data: emails } = await supabase
          .from("email_logs")
          .select("subject, from_name, from_email, direction, category, date")
          .eq("project_name", project.name)
          .order("date", { ascending: false })
          .limit(10);

        if (emails && emails.length > 0) {
          context.recentEmails = emails;
        }
      }
    } else {
      // General context: open todos across all projects
      const { data: todos } = await supabase
        .from("todos")
        .select("contact_name, description, priority, due_date")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(10);

      if (todos && todos.length > 0) {
        context.openTodos = todos;
      }
    }

    // Always include available subs
    const { data: subs } = await supabase
      .from("subcontractors")
      .select("company_name, contact_name, email, phone, trade")
      .limit(30);

    if (subs && subs.length > 0) {
      context.subcontractors = subs;
    }
  } catch {
    // If any context query fails, continue with whatever we have
  }

  return context;
}
