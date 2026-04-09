import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_OPUS_FALLBACK, logAiUsage } from "@/lib/ai/claude";
import { ALL_TOOLS, isReadTool } from "@/lib/ai/shared-tools";
import { executeTool } from "@/lib/ai/shared-tool-handlers";
import { buildBrainPrompt } from "@/lib/ai/prompts/brain";
import { buildProjectPrompt } from "@/lib/ai/prompts/project";
import { loadBrainContext, loadProjectContext } from "@/lib/ai/shared-context";
import { loadMemories, loadActionPatterns, parseRememberCommand, saveMemory } from "@/lib/ai/memory";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 120;

type MessageParam = Anthropic.MessageParam;
type ContentBlockParam = Anthropic.ContentBlockParam;

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

    // Get or create conversation
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

      if (convId) {
        await supabase.from("conversation_messages").insert({
          conversation_id: convId,
          role: "user",
          content: message,
          source,
        });

        const { data: history } = await supabase
          .from("conversation_messages")
          .select("role, content")
          .eq("conversation_id", convId)
          .order("created_at", { ascending: true })
          .limit(50);

        conversationHistory = history || [];
      }
    } catch {
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

    // Handle "remember" commands
    const rememberCmd = await parseRememberCommand(message);
    if (rememberCmd.isRemember && rememberCmd.key && rememberCmd.value) {
      await saveMemory(rememberCmd.category!, rememberCmd.key, rememberCmd.value, "user_taught");
    }

    // Build system prompt — project-specific or brain (cross-project)
    const [memoryContext, patternContext] = await Promise.all([
      loadMemories(supabase, user.id),
      loadActionPatterns(supabase, user.id),
    ]);

    let systemPrompt: string;
    if (projectId) {
      const ctx = await loadProjectContext(supabase, projectId);
      systemPrompt = ctx
        ? await buildProjectPrompt(ctx)
        : await buildBrainPrompt(await loadBrainContext(supabase));
    } else {
      systemPrompt = await buildBrainPrompt(await loadBrainContext(supabase));
    }

    // Append memory context
    if (memoryContext) systemPrompt += memoryContext;
    if (patternContext) systemPrompt += patternContext;

    const anthropic = await getAnthropicClient();
    let usedModel = CLAUDE_OPUS_FALLBACK[0];

    // Stream response with tool use loop
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "conversation_id", id: convId })}\n\n`
            )
          );

          let currentMessages: MessageParam[] = [...messages];
          let fullResponse = "";
          const MAX_TOOL_ROUNDS = 8;
          let totalInputTokens = 0;
          let totalOutputTokens = 0;

          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            let response: Anthropic.Message;

            try {
              response = await anthropic.messages.create({
                model: usedModel,
                max_tokens: 8192,
                system: systemPrompt,
                messages: currentMessages,
                tools: ALL_TOOLS,
              });
            } catch {
              if (usedModel !== CLAUDE_OPUS_FALLBACK[1]) {
                usedModel = CLAUDE_OPUS_FALLBACK[1];
                response = await anthropic.messages.create({
                  model: usedModel,
                  max_tokens: 8192,
                  system: systemPrompt,
                  messages: currentMessages,
                  tools: ALL_TOOLS,
                });
              } else {
                throw new Error("All models failed");
              }
            }

            if (response.usage) {
              totalInputTokens += response.usage.input_tokens;
              totalOutputTokens += response.usage.output_tokens;
            }

            const toolUseBlocks = response.content.filter(
              (b): b is Anthropic.ContentBlock & { type: "tool_use" } =>
                b.type === "tool_use"
            );
            const textBlocks = response.content.filter(
              (b): b is Anthropic.TextBlock => b.type === "text"
            );

            // Stream text
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

            if (toolUseBlocks.length === 0 || response.stop_reason !== "tool_use") {
              break;
            }

            // Split tools by read/write using shared classifier
            const autoTools = toolUseBlocks.filter((t) => isReadTool(t.name));
            const approvalTools = toolUseBlocks.filter((t) => !isReadTool(t.name));

            // Emit proposed_action events for write tools
            for (const tool of approvalTools) {
              const toolInput = tool.input as Record<string, unknown>;
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

            // If no auto-execute tools, tell Claude the actions were proposed
            if (autoTools.length === 0) {
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
                    content: !isReadTool(t.name)
                      ? JSON.stringify({ proposed: true, message: "Action proposed to user — they will approve or reject via UI. Do NOT re-propose." })
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
                  `data: ${JSON.stringify({ type: "tool_status", tool: tool.name, status: "running" })}\n\n`
                )
              );
            }

            const toolResults = await Promise.all(
              autoTools.map(async (tool) => {
                const result = await executeTool(
                  tool.name,
                  tool.input as Record<string, unknown>,
                  supabase,
                  user.id
                );
                return { tool_use_id: tool.id, result };
              })
            );

            for (const tool of autoTools) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "tool_status", tool: tool.name, status: "done" })}\n\n`
                )
              );
            }

            // Build combined tool results
            const allResults = toolUseBlocks.map((t) => {
              const autoResult = toolResults.find((r) => r.tool_use_id === t.id);
              if (autoResult) {
                return { type: "tool_result" as const, tool_use_id: t.id, content: autoResult.result };
              }
              return {
                type: "tool_result" as const,
                tool_use_id: t.id,
                content: JSON.stringify({ proposed: true, message: "Action proposed to user for approval. Do NOT re-propose." }),
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

          // Save assistant response
          if (convId && fullResponse) {
            try {
              await supabase.from("conversation_messages").insert({
                conversation_id: convId,
                role: "assistant",
                content: fullResponse,
                metadata: { model: usedModel },
              });
            } catch { /* ignore */ }
          }

          // Log usage
          if (totalInputTokens > 0 || totalOutputTokens > 0) {
            logAiUsage({
              userId: user.id,
              endpoint: "chat",
              model: usedModel,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              context: projectId ? `project:${projectId}` : undefined,
            });
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
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

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
    case "create_subcontractor":
      return `Add Sub: ${String(data.company_name || "")}`;
    case "create_quote_request":
      return `Quote: ${data.subcontractor_name} — ${data.trade}`;
    case "create_invoice":
      return `Invoice: ${data.vendor_name} — $${data.amount}`;
    case "record_payment":
      return `Payment: ${data.payment_type} — $${data.amount}`;
    case "create_change_order":
      return `Change Order: ${String(data.title || "")}`;
    case "update_todo":
      return `Update Todo${data.status ? ` → ${data.status}` : ""}`;
    case "update_project":
      return `Update Project${data.status ? ` → ${data.status}` : ""}`;
    case "send_email":
      return `Send Email to ${String(data.to || "")}`;
    case "link_email_to_project":
      return `Link Email to Project`;
    case "create_schedule_event":
      return `Schedule: ${String(data.title || "")}`;
    case "create_schedule_phase":
      return `Add Phase: ${String(data.name || "")}`;
    case "update_schedule_phase":
      return `Update Phase`;
    default:
      return actionType;
  }
}
