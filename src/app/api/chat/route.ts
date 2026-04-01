import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_OPUS_FALLBACK } from "@/lib/ai/claude";
import { buildChatSystemPrompt, type ChatContext } from "@/lib/ai/chat-system-prompt";
import { CHAT_TOOLS } from "@/lib/ai/chat-tools";
import { executeTool } from "@/lib/ai/tool-handlers";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 120;

type MessageParam = Anthropic.MessageParam;
type ContentBlockParam = Anthropic.ContentBlockParam;

// Tools that execute immediately (read-only / search)
const AUTO_EXECUTE_TOOLS = new Set([
  "search_projects",
  "get_project_details",
  "search_customers",
  "search_subcontractors",
  "search_emails",
  "get_email_details",
  "list_quotes",
  "list_todos",
  "get_schedule",
]);

// Tools that require user approval (write / side effects)
const APPROVAL_TOOLS = new Set([
  "create_todo",
  "create_project",
  "create_customer",
  "create_quote_request",
  "update_todo",
  "update_project",
  "draft_email",
  "send_email",
  "create_schedule_event",
  "create_schedule_phase",
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Not authenticated", { status: 401 });
  }

  try {
    const { message, conversationId, projectId, source = "text" } =
      await request.json();

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

    // Build messages array
    const messages: MessageParam[] =
      conversationHistory.length > 0
        ? conversationHistory.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        : [{ role: "user" as const, content: message }];

    // Build context + system prompt
    const context = await buildContext(supabase, projectId);
    const anthropic = await getAnthropicClient();
    const systemPrompt = buildChatSystemPrompt(context);

    // Pick model
    let usedModel = CLAUDE_OPUS_FALLBACK[0];

    // Stream response with tool use loop
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          // Send conversation ID first
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "conversation_id", id: convId })}\n\n`
            )
          );

          // The messages we'll send to Claude (may grow with tool results)
          let currentMessages: MessageParam[] = [...messages];
          let fullResponse = "";
          const MAX_TOOL_ROUNDS = 8; // Safety limit

          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            // Call Claude (non-streaming for tool rounds, streaming for final)
            let response: Anthropic.Message;

            try {
              response = await anthropic.messages.create({
                model: usedModel,
                max_tokens: 8192,
                system: systemPrompt,
                messages: currentMessages,
                tools: CHAT_TOOLS,
              });
            } catch {
              // Try fallback model
              if (usedModel !== CLAUDE_OPUS_FALLBACK[1]) {
                usedModel = CLAUDE_OPUS_FALLBACK[1];
                response = await anthropic.messages.create({
                  model: usedModel,
                  max_tokens: 8192,
                  system: systemPrompt,
                  messages: currentMessages,
                  tools: CHAT_TOOLS,
                });
              } else {
                throw new Error("All models failed");
              }
            }

            // Check if Claude wants to use tools
            const toolUseBlocks = response.content.filter(
              (b): b is Anthropic.ContentBlock & { type: "tool_use" } =>
                b.type === "tool_use"
            );
            const textBlocks = response.content.filter(
              (b): b is Anthropic.TextBlock => b.type === "text"
            );

            // Stream any text that came before tool calls
            for (const block of textBlocks) {
              if (block.text) {
                fullResponse += block.text;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`
                  )
                );
              }
            }

            // If no tool use, we're done
            if (toolUseBlocks.length === 0 || response.stop_reason !== "tool_use") {
              break;
            }

            // Split tools into auto-execute (reads) and approval-needed (writes)
            const autoTools = toolUseBlocks.filter((t) => AUTO_EXECUTE_TOOLS.has(t.name));
            const approvalTools = toolUseBlocks.filter((t) => APPROVAL_TOOLS.has(t.name));

            // Emit proposed_action events for write tools (user must approve)
            for (const tool of approvalTools) {
              const toolInput = tool.input as Record<string, unknown>;
              // Map send_email/draft_email both to send_email for the action card
              const actionType = tool.name === "draft_email" ? "send_email" : tool.name;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "proposed_action",
                    action_id: tool.id,
                    action_type: actionType,
                    label: getActionLabel(actionType, toolInput),
                    data: toolInput,
                  })}\n\n`
                )
              );
            }

            // If there are no auto-execute tools, just tell Claude the actions were proposed
            if (autoTools.length === 0) {
              // Build tool results that tell Claude the actions were proposed to the user
              currentMessages = [
                ...currentMessages,
                {
                  role: "assistant" as const,
                  content: response.content as ContentBlockParam[],
                },
                {
                  role: "user" as const,
                  content: toolUseBlocks.map((t) => ({
                    type: "tool_result" as const,
                    tool_use_id: t.id,
                    content: APPROVAL_TOOLS.has(t.name)
                      ? JSON.stringify({ proposed: true, message: "Action proposed to user — they will approve or reject it via the UI. Do NOT re-propose or re-execute. Just acknowledge what you proposed." })
                      : JSON.stringify({ error: "Unknown tool" }),
                  })),
                },
              ];

              if (response.stop_reason !== "tool_use") break;
              continue;
            }

            // Auto-execute read tools
            for (const tool of autoTools) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "tool_status",
                    tool: tool.name,
                    status: "running",
                  })}\n\n`
                )
              );
            }

            const toolResults = await Promise.all(
              autoTools.map(async (tool) => {
                const result = await executeTool(
                  tool.name,
                  tool.input as Record<string, unknown>,
                  supabase
                );
                return { tool_use_id: tool.id, result };
              })
            );

            for (const tool of autoTools) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "tool_status",
                    tool: tool.name,
                    status: "done",
                  })}\n\n`
                )
              );
            }

            // Build combined tool results
            const allResults = toolUseBlocks.map((t) => {
              const autoResult = toolResults.find((r) => r.tool_use_id === t.id);
              if (autoResult) {
                return { type: "tool_result" as const, tool_use_id: t.id, content: autoResult.result };
              }
              // This was an approval tool — tell Claude it was proposed
              return {
                type: "tool_result" as const,
                tool_use_id: t.id,
                content: JSON.stringify({ proposed: true, message: "Action proposed to user for approval. Do NOT re-propose or re-execute." }),
              };
            });

            currentMessages = [
              ...currentMessages,
              {
                role: "assistant" as const,
                content: response.content as ContentBlockParam[],
              },
              {
                role: "user" as const,
                content: allResults,
              },
            ];

            if (response.stop_reason !== "tool_use") break;
          }

          // Save assistant response to DB
          if (convId && fullResponse) {
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
            encoder.encode(
              `data: ${JSON.stringify({ type: "done", conversationId: convId })}\n\n`
            )
          );
          controller.close();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Stream error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: errMsg })}\n\n`
            )
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
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Build chat context from database for the system prompt.
 */
function getActionLabel(
  actionType: string,
  data: Record<string, unknown>
): string {
  switch (actionType) {
    case "create_todo":
      return `Create Todo: ${String(data.description || "").substring(0, 50)}`;
    case "create_project":
      return `Create Project: ${String(data.name || "")}`;
    case "create_customer":
      return `Add Customer: ${data.first_name} ${data.last_name}`;
    case "create_quote_request":
      return `Quote: ${data.subcontractor_name} — ${data.trade}`;
    case "update_todo":
      return `Update Todo${data.status ? ` → ${data.status}` : ""}`;
    case "update_project":
      return `Update Project${data.status ? ` → ${data.status}` : ""}`;
    case "send_email":
      return `Send Email to ${String(data.to || "")}`;
    case "create_schedule_event":
      return `Schedule: ${String(data.title || "")}`;
    case "create_schedule_phase":
      return `Add Phase: ${String(data.phase_name || "")}`;
    default:
      return actionType;
  }
}

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
        const customer = Array.isArray(project.customer)
          ? project.customer[0]
          : project.customer;
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
          customer_name: customer
            ? `${customer.first_name} ${customer.last_name}`
            : null,
          customer_email: customer?.email || null,
        };

        const { data: quotes } = await supabase
          .from("quote_requests")
          .select("subcontractor_name, trade, amount, status")
          .eq("project_name", project.name)
          .limit(20);

        if (quotes && quotes.length > 0) {
          context.openQuotes = quotes;
        }

        const { data: todos } = await supabase
          .from("todos")
          .select("contact_name, description, priority, due_date")
          .eq("project_name", project.name)
          .eq("status", "open")
          .limit(20);

        if (todos && todos.length > 0) {
          context.openTodos = todos;
        }

        const { data: emails } = await supabase
          .from("email_logs")
          .select(
            "subject, from_name, from_email, direction, category, date"
          )
          .eq("project_name", project.name)
          .order("date", { ascending: false })
          .limit(10);

        if (emails && emails.length > 0) {
          context.recentEmails = emails;
        }
      }
    } else {
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
