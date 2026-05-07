import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_SONNET_FALLBACK, logAiUsage } from "@/lib/ai/claude";
import { ALL_TOOLS, FIELD_TOOLS, isReadTool } from "@/lib/ai/shared-tools";
import { executeTool } from "@/lib/ai/shared-tool-handlers";
import { buildBrainPrompt } from "@/lib/ai/prompts/brain";
import { buildProjectPrompt } from "@/lib/ai/prompts/project";
import { loadBrainContext, loadProjectContext } from "@/lib/ai/shared-context";
import { loadMemories, loadActionPatterns, parseRememberCommand, saveMemory } from "@/lib/ai/memory";
import { loadProjectDocsContext } from "@/lib/ai/project-docs";
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

  // Field crew gets a stripped-down tool list and prompt — no financial data.
  // Role check uses the real profile (impersonation should NOT bypass this:
  // if Jorge is impersonating Howie, Howie's restrictions apply).
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const isField = profile?.role === "field";
  const toolsForUser = isField ? FIELD_TOOLS : ALL_TOOLS;

  try {
    const { message, conversationId, projectId, source = "text", attachments } =
      await request.json();

    if (!message || typeof message !== "string") {
      return new Response("Message is required", { status: 400 });
    }

    // Process attachments — download and extract content for AI
    let attachmentContext = "";
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      for (const att of attachments) {
        try {
          if (att.type === "upload" && att.storagePath) {
            // Download from Supabase storage
            const { data: blob } = await supabase.storage
              .from("email-attachments")
              .download(att.storagePath);

            if (blob) {
              const isPdf = att.mimeType === "application/pdf" || att.filename?.endsWith(".pdf");
              if (isPdf) {
                // For PDFs, extract text content via base64 + Claude document understanding
                const buffer = Buffer.from(await blob.arrayBuffer());
                const base64 = buffer.toString("base64");
                // We'll include the PDF as a document block in the message
                attachmentContext += `\n\n[Attached PDF: ${att.filename}]\nStorage path: ${att.storagePath}\nFile uploaded and available for analysis. To attach this file to an email, use storage_path: "${att.storagePath}" and filename: "${att.filename}" in draft_email attachments.`;
                // Store base64 for later use in message content blocks
                att._base64 = base64;
                att._mediaType = "application/pdf";
              } else if (att.mimeType?.startsWith("image/")) {
                const buffer = Buffer.from(await blob.arrayBuffer());
                att._base64 = buffer.toString("base64");
                att._mediaType = att.mimeType;
                attachmentContext += `\n\n[Attached image: ${att.filename}]\nStorage path: ${att.storagePath}\nTo attach this file to an email, use storage_path: "${att.storagePath}" and filename: "${att.filename}" in draft_email attachments.`;
              } else {
                // Text-based files
                const text = await blob.text();
                attachmentContext += `\n\n[Attached file: ${att.filename}]\nStorage path: ${att.storagePath}\nTo attach this file to an email, use storage_path: "${att.storagePath}" and filename: "${att.filename}" in draft_email attachments.\n${text.substring(0, 10000)}`;
              }
            }
          } else if (att.type === "drive" && att.driveLink) {
            attachmentContext += `\n\n[Google Drive file: ${att.filename}]\nLink: ${att.driveLink}`;
          }
        } catch (err) {
          attachmentContext += `\n\n[Failed to load attachment: ${att.filename}]`;
        }
      }
    }

    // Get or create conversation
    let convId = conversationId || null;
    let conversationHistory: Array<{
      role: string;
      content: string;
      metadata?: Record<string, unknown> | null;
    }> = [];

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
        // Persist any attachment refs (storage_path, drive link, filename) so
        // the AI can reference them on later turns. Without this, every new
        // turn loses access to previously uploaded files and the AI either
        // hallucinates paths or claims the files were never sent.
        const persistedAttachments = (attachments || [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((a: any) => ({
            type: a.type,
            filename: a.filename,
            mimeType: a.mimeType,
            storagePath: a.storagePath,
            driveFileId: a.driveFileId,
            driveLink: a.driveLink,
          }));

        await supabase.from("conversation_messages").insert({
          conversation_id: convId,
          role: "user",
          content: message,
          source,
          metadata:
            persistedAttachments.length > 0
              ? { attachments: persistedAttachments }
              : {},
        });

        const { data: history } = await supabase
          .from("conversation_messages")
          .select("role, content, metadata")
          .eq("conversation_id", convId)
          .order("created_at", { ascending: true })
          .limit(50);

        conversationHistory = history || [];
      }
    } catch {
      convId = null;
    }

    // Build messages array. For each historical user message that had
    // attachments, append the stored storage_path/filename so the AI can
    // re-reference it on later turns instead of hallucinating paths.
    let messages: MessageParam[] =
      conversationHistory.length > 0
        ? conversationHistory.map((m) => {
            // The freshly-inserted user message (last item) gets attachment
            // blocks added below; skip annotating it here to avoid duplicate
            // path callouts in the same turn.
            const meta = m.metadata as
              | { attachments?: Array<{ filename?: string; mimeType?: string; storagePath?: string; driveLink?: string; driveFileId?: string }> }
              | null
              | undefined;
            const atts = meta?.attachments || [];
            let content = m.content;
            if (m.role === "user" && atts.length > 0) {
              const lines = atts
                .map((a) => {
                  if (a.storagePath) {
                    return `- ${a.filename} (${a.mimeType || "file"}) — storage_path: "${a.storagePath}"`;
                  }
                  if (a.driveFileId) {
                    return `- ${a.filename} — drive_file_id: "${a.driveFileId}"`;
                  }
                  if (a.driveLink) {
                    return `- ${a.filename} — drive link: ${a.driveLink}`;
                  }
                  return `- ${a.filename}`;
                })
                .join("\n");
              content += `\n\n[Files attached to this message — use these EXACT paths if attaching to an email]\n${lines}`;
            }
            return {
              role: m.role as "user" | "assistant",
              content,
            };
          })
        : [{ role: "user" as const, content: message }];

    // If attachments have binary content (PDFs, images), build multipart content for the last user message
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const binaryAttachments = (attachments || []).filter((a: any) => a._base64);
    if (binaryAttachments.length > 0) {
      const contentBlocks: ContentBlockParam[] = [];

      // Add document/image blocks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const att of binaryAttachments as any[]) {
        if (att._mediaType === "application/pdf") {
          contentBlocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: att._base64 },
          } as ContentBlockParam);
        } else if (att._mediaType?.startsWith("image/")) {
          contentBlocks.push({
            type: "image",
            source: { type: "base64", media_type: att._mediaType, data: att._base64 },
          } as ContentBlockParam);
        }
      }

      // Add the text message
      const fullMessage = message + (attachmentContext || "");
      contentBlocks.push({ type: "text", text: fullMessage });

      // Replace the last user message with multipart content
      const lastIdx = messages.length - 1;
      if (lastIdx >= 0 && messages[lastIdx].role === "user") {
        messages[lastIdx] = { role: "user", content: contentBlocks };
      }
    } else if (attachmentContext) {
      // Text-only attachments — append context to the last user message
      const lastIdx = messages.length - 1;
      if (lastIdx >= 0 && messages[lastIdx].role === "user") {
        const existing = typeof messages[lastIdx].content === "string" ? messages[lastIdx].content as string : message;
        messages[lastIdx] = { role: "user", content: existing + attachmentContext };
      }
    }

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
      const ctx = await loadProjectContext(supabase, projectId, isField);
      systemPrompt = ctx
        ? await buildProjectPrompt(ctx)
        : await buildBrainPrompt(await loadBrainContext(supabase, isField));
    } else {
      systemPrompt = await buildBrainPrompt(await loadBrainContext(supabase, isField));
    }

    // Append memory context
    if (memoryContext) systemPrompt += memoryContext;
    if (patternContext) systemPrompt += patternContext;

    // Inject the project's registered documents so the AI never has to
    // guess. Brain chat (no projectId) gets an empty string back.
    systemPrompt += await loadProjectDocsContext(supabase, projectId);

    const anthropic = await getAnthropicClient();
    let usedModel = CLAUDE_SONNET_FALLBACK[0];

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

          // Prompt caching cuts the bill ~10x on the static portion of
          // every request. Two breakpoints:
          //   1. Last tool definition → caches the entire tools array.
          //   2. System prompt → caches the system block.
          // Cache writes cost 1.25x base; cache reads cost 0.1x base.
          // First message in a conversation pays the write premium;
          // every follow-up inside a 5-minute window reads at 10% cost.
          const cachedTools = toolsForUser.map((t, i) =>
            i === toolsForUser.length - 1
              ? ({ ...t, cache_control: { type: "ephemeral" as const } } as Anthropic.Tool)
              : t
          );
          const cachedSystem: Anthropic.TextBlockParam[] = [
            { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
          ];

          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            let response: Anthropic.Message;

            try {
              response = await anthropic.messages.create({
                model: usedModel,
                max_tokens: 8192,
                system: cachedSystem,
                messages: currentMessages,
                tools: cachedTools,
              });
            } catch {
              if (usedModel !== CLAUDE_SONNET_FALLBACK[1]) {
                usedModel = CLAUDE_SONNET_FALLBACK[1];
                response = await anthropic.messages.create({
                  model: usedModel,
                  max_tokens: 8192,
                  system: cachedSystem,
                  messages: currentMessages,
                  tools: cachedTools,
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
    case "generate_estimate":
      return `Generate Estimate${data.project_name ? `: ${data.project_name}` : ""}`;
    case "generate_proposal":
      return `Generate Proposal${data.project_name ? `: ${data.project_name}` : ""}`;
    case "generate_change_order_pdf":
      return `Generate Change Order PDF`;
    case "generate_financial_report":
      return `Generate Financial Report${data.project_name ? `: ${data.project_name}` : ""}`;
    default:
      return actionType;
  }
}
