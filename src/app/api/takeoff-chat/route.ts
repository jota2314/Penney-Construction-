/**
 * POST /api/takeoff-chat
 *
 * Dedicated estimating AI for the takeoff viewer.
 * Has access to: estimate line items, cost book, project details.
 * Can: update/add estimate line items, look up pricing.
 * Cannot: send emails, create projects, manage schedule, etc.
 */

import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, CLAUDE_FALLBACK_MODELS, nowStamp, logAiUsage } from "@/lib/ai/claude";
import { ALL_TOOLS, isReadTool } from "@/lib/ai/shared-tools";
import { executeTool } from "@/lib/ai/shared-tool-handlers";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 120;

type MessageParam = Anthropic.MessageParam;
type ContentBlockParam = Anthropic.ContentBlockParam;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Not authenticated", { status: 401 });

  try {
    const {
      message,
      projectId,
      conversationId: incomingConvId,
      drawingContext = "",
      measurementSummary = "",
      estimateContext = "",
      images = [],
    } = await request.json() as {
      message: string;
      projectId?: string;
      conversationId?: string;
      drawingContext?: string;
      measurementSummary?: string;
      estimateContext?: string;
      images?: Array<{ base64: string; mediaType: string }>;
    };

    if (!message && images.length === 0) return new Response("Message or image required", { status: 400 });

    // ── Conversation persistence ──────────────────────────────
    let convId = incomingConvId || null;
    let conversationHistory: Array<{ role: string; content: string }> = [];

    try {
      if (!convId && projectId) {
        // Look for existing takeoff conversation for this project
        const { data: existing } = await supabase
          .from("conversations")
          .select("id")
          .eq("project_id", projectId)
          .eq("title", "Takeoff Estimating")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existing) {
          convId = existing.id;
        } else {
          const { data: conv } = await supabase
            .from("conversations")
            .insert({
              user_id: user.id,
              project_id: projectId,
              title: "Takeoff Estimating",
            })
            .select("id")
            .single();
          if (conv) convId = conv.id;
        }
      } else if (!convId) {
        const { data: conv } = await supabase
          .from("conversations")
          .insert({
            user_id: user.id,
            title: "Takeoff Estimating",
          })
          .select("id")
          .single();
        if (conv) convId = conv.id;
      }

      if (convId) {
        // Save user message
        await supabase.from("conversation_messages").insert({
          conversation_id: convId,
          role: "user",
          content: message || "[screenshot]",
          source: "text",
        });

        // Load history
        const { data: history } = await supabase
          .from("conversation_messages")
          .select("role, content")
          .eq("conversation_id", convId)
          .order("created_at", { ascending: true })
          .limit(20);

        conversationHistory = history || [];
      }
    } catch { /* non-critical */ }

    // Load trade rates for the estimator prompt
    const { data: tradeRatesRaw } = await supabase
      .from("trade_rates")
      .select("trade_name, unit_type, avg_price, avg_cost")
      .eq("is_active", true);

    const tradeRates = (tradeRatesRaw || [])
      .map(r => `  ${r.trade_name} [${r.unit_type}] — cost $${r.avg_cost} / price $${r.avg_price}`)
      .join("\n");

    // Load project info
    let projectInfo = "";
    if (projectId) {
      const { data: project } = await supabase
        .from("projects")
        .select("name, project_type, address, scope_of_work")
        .eq("id", projectId)
        .single();
      if (project) {
        projectInfo = `Project: ${project.name}\nType: ${project.project_type || "residential"}\nAddress: ${project.address || "N/A"}\nJorge's draft budget notes:\n${project.scope_of_work || "(none)"}`;
      }
    }

    const systemPrompt = `You are the estimating AI for Penney Construction — a residential GC on the North Shore of Massachusetts. ${nowStamp()}

You are Jorge's estimating command center. You help build estimates from drawings AND handle everything around the estimate: proposals, emails, bid packages, quotes, documents.

## ESTIMATING (primary job)
1. Listen to what Jorge describes (scope, quantities, trades, materials, screenshots)
2. Use get_budget_lines to see what line items already exist in the estimate
3. If a line item exists for that trade → use update_estimate_line_item to fill in scope_text, quantity, unit, and pricing
4. If no line item exists → use add_estimate_line_item to create one
5. Use search_costbook to look up Penney's real unit prices for pricing
6. Default markup: cost × 1.30 = client price, unless Jorge says otherwise

## EVERYTHING ELSE YOU CAN DO
- **Generate proposals** (PDF + Excel) → generate_proposal
- **Generate estimates** from scope → generate_estimate
- **Generate financial reports** → generate_financial_report
- **Generate change order PDFs** → generate_change_order_pdf
- **Find documents** → list_project_documents
- **Draft & send emails** with attachments → draft_email, send_email
- **Search projects, customers, subs** → search tools
- **Create/update quotes, invoices, payments, change orders** → write tools
- **Manage schedule** → schedule tools
- **Create todos** → create_todo

## RULES
- When Jorge describes scope → update/add estimate lines immediately
- ALWAYS look up pricing in the cost book before setting prices
- Write scope_text in Jorge's style: specific, dashes for bullet points, includes quantities and materials
- If Jorge gives an allowance or lump sum, use unit=LS and qty=1
- For emails: ALWAYS use draft_email first so Jorge can review before sending
- When emailing a proposal/document: include attachments in draft_email using the document URLs from the generation result. Example: attachments: [{ url: "/api/generate-proposal-pdf?projectId=xxx", filename: "Project - Proposal.pdf" }]
- When emailing, get the client's email from get_project_details (customer info) — don't ask Jorge for it
- Respond briefly — confirm what you did, show key numbers. Don't be verbose.
- When Jorge asks to "see" or "show" a proposal/PDF/document, ALWAYS call the generate tool (generate_proposal, generate_financial_report, etc.) — the system will auto-open it and show download buttons. NEVER say you can't show a PDF. You CAN — just call the tool.
- NEVER say "I can't render a PDF" or "I can't display documents" — you have tools that generate and deliver them.

${projectInfo ? `## PROJECT\n${projectInfo}\n` : ""}
## PENNEY TRADE RATES
${tradeRates || "(none loaded)"}

${drawingContext ? `## DRAWING CONTEXT (extracted from PDF)\n${drawingContext.substring(0, 3000)}\n` : ""}
${measurementSummary ? `## CURRENT MEASUREMENTS\n${measurementSummary}\n` : ""}
${estimateContext ? `## CURRENT ESTIMATE LINES\n${estimateContext}\n` : ""}`;

    // Build messages from history
    const historyMessages: MessageParam[] = conversationHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Build current user message — may include images
    let userContent: MessageParam["content"];
    if (images.length > 0) {
      const contentBlocks: ContentBlockParam[] = [];
      for (const img of images) {
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: img.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: img.base64 },
        } as ContentBlockParam);
      }
      contentBlocks.push({ type: "text", text: message || "What do you see in this drawing? Identify scope, quantities, and trades. Update the estimate." });
      userContent = contentBlocks;
    } else {
      userContent = message;
    }

    const messages: MessageParam[] = [
      ...historyMessages,
      { role: "user" as const, content: userContent },
    ];

    const anthropic = await getAnthropicClient();
    let usedModel = "claude-sonnet-4-6"; // Sonnet 4.6 — smart + cost-effective

    // Stream response with tool loop
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          // Emit conversation ID so client can persist it
          if (convId) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "conversation_id", id: convId })}\n\n`));
          }

          let currentMessages = [...messages];
          let fullResponse = "";
          const MAX_ROUNDS = 4;
          let totalInputTokens = 0;
          let totalOutputTokens = 0;

          for (let round = 0; round < MAX_ROUNDS; round++) {
            let response: Anthropic.Message;
            try {
              response = await anthropic.messages.create({
                model: usedModel,
                max_tokens: 2048,
                system: systemPrompt,
                messages: currentMessages,
                tools: ALL_TOOLS,
              });
            } catch {
              if (usedModel !== "claude-sonnet-4-20250514") {
                usedModel = "claude-sonnet-4-20250514";
                response = await anthropic.messages.create({
                  model: usedModel,
                  max_tokens: 2048,
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
              (b): b is Anthropic.ContentBlock & { type: "tool_use" } => b.type === "tool_use"
            );
            const textBlocks = response.content.filter(
              (b): b is Anthropic.TextBlock => b.type === "text"
            );

            // Stream text
            for (const block of textBlocks) {
              if (block.text) {
                fullResponse += block.text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`));
              }
            }

            if (toolUseBlocks.length === 0 || response.stop_reason !== "tool_use") break;

            // Classify: auto-execute reads + estimating tools, propose other writes
            const ESTIMATING_AUTO = new Set(["update_estimate_line_item", "add_estimate_line_item", "generate_estimate", "generate_proposal", "generate_change_order_pdf", "generate_financial_report"]);
            const autoTools = toolUseBlocks.filter(t => isReadTool(t.name) || ESTIMATING_AUTO.has(t.name));
            const approvalTools = toolUseBlocks.filter(t => !isReadTool(t.name) && !ESTIMATING_AUTO.has(t.name));

            // Emit proposed_action for write tools that need approval
            for (const tool of approvalTools) {
              const toolInput = tool.input as Record<string, unknown>;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: "proposed_action",
                action_id: tool.id,
                action_type: tool.name === "draft_email" ? "send_email" : tool.name,
                label: getToolLabel(tool.name, toolInput),
                data: toolInput,
              })}\n\n`));
            }

            // Auto-execute reads + estimating tools
            for (const tool of autoTools) {
              const label = isReadTool(tool.name) ? `Looking up ${tool.name.replace(/_/g, " ")}...` : `Working...`;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_status", tool: tool.name, label })}\n\n`));
            }

            const autoResults = await Promise.all(
              autoTools.map(async (tool) => {
                const result = await executeTool(
                  tool.name,
                  tool.input as Record<string, unknown>,
                  supabase,
                  user.id,
                  request
                );
                return { tool_use_id: tool.id, result };
              })
            );

            // Notify about estimate changes + document downloads
            for (const ar of autoResults) {
              try {
                const parsed = JSON.parse(ar.result);
                if (parsed.documents) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "documents_ready", documents: parsed.documents })}\n\n`));
                } else if (parsed.document_url) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "documents_ready", documents: [{ url: parsed.document_url, filename: parsed.filename || "document", type: parsed.document_type || "pdf" }] })}\n\n`));
                }
              } catch { /* ignore */ }
            }
            for (const tool of autoTools) {
              if (tool.name === "update_estimate_line_item" || tool.name === "add_estimate_line_item") {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "estimate_updated" })}\n\n`));
              }
            }

            // Build combined tool results
            const allResults = toolUseBlocks.map(t => {
              const autoResult = autoResults.find(r => r.tool_use_id === t.id);
              if (autoResult) {
                return { type: "tool_result" as const, tool_use_id: t.id, content: autoResult.result };
              }
              return {
                type: "tool_result" as const,
                tool_use_id: t.id,
                content: JSON.stringify({ proposed: true, message: "Action proposed to user for approval." }),
              };
            });

            currentMessages = [
              ...currentMessages,
              { role: "assistant" as const, content: response.content as ContentBlockParam[] },
              { role: "user" as const, content: allResults },
            ];

            if (response.stop_reason !== "tool_use") break;
          }

          // Save assistant response to conversation
          if (convId && fullResponse) {
            try {
              await supabase.from("conversation_messages").insert({
                conversation_id: convId,
                role: "assistant",
                content: fullResponse,
                metadata: { model: usedModel },
              });
            } catch { /* non-critical */ }
          }

          if (totalInputTokens > 0 || totalOutputTokens > 0) {
            logAiUsage({
              userId: user.id,
              endpoint: "takeoff-chat",
              model: usedModel,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              context: projectId ? `project:${projectId}` : undefined,
            });
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          controller.close();
        } catch (err) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : "Stream error" })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}

function getToolLabel(name: string, data: Record<string, unknown>): string {
  switch (name) {
    case "send_email":
    case "draft_email":
      return `Send Email to ${String(data.to || "")}`;
    case "create_todo":
      return `Create Todo: ${String(data.description || "").substring(0, 50)}`;
    case "create_project":
      return `Create Project: ${String(data.name || "")}`;
    case "create_quote_request":
      return `Quote: ${data.subcontractor_name} — ${data.trade}`;
    case "create_invoice":
      return `Invoice: ${data.vendor_name} — $${data.amount}`;
    case "create_change_order":
      return `Change Order: ${String(data.title || "")}`;
    case "record_payment":
      return `Payment: $${data.amount}`;
    default:
      return name.replace(/_/g, " ");
  }
}
