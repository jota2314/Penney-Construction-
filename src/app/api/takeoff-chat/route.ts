/**
 * POST /api/takeoff-chat
 *
 * Dedicated estimating AI for the takeoff viewer.
 * Has access to: estimate line items, cost book, project details.
 * Can: update/add estimate line items, look up pricing.
 * Cannot: send emails, create projects, manage schedule, etc.
 */

import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_OPUS_FALLBACK, nowStamp, logAiUsage } from "@/lib/ai/claude";
import { TAKEOFF_CHAT_TOOLS, isReadTool } from "@/lib/ai/shared-tools";
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
      conversationHistory = [],
      drawingContext = "",
      measurementSummary = "",
      estimateContext = "",
    } = await request.json();

    if (!message) return new Response("Message required", { status: 400 });

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

You are helping Jorge build an estimate while he reads construction drawings. He will describe what he sees — scope, quantities, materials, trades — and you write it into the estimate.

## YOUR JOB
1. Listen to what Jorge describes (scope, quantities, trades, materials)
2. Use get_budget_lines to see what line items already exist in the estimate
3. If a line item exists for that trade → use update_estimate_line_item to fill in scope_text, quantity, unit, and pricing
4. If no line item exists → use add_estimate_line_item to create one
5. Use search_costbook to look up Penney's real unit prices for pricing
6. Default markup: cost × 1.30 = client price, unless Jorge says otherwise

## RULES
- When Jorge says "demo is 500 square feet" → find or create Demolition line, set qty=500, unit=SF, write scope, price it
- When Jorge says "5 windows, double hung" → find or create Windows line, set qty=5, unit=EA, write scope
- When Jorge says "vinyl siding, about 800 SF" → find or create Siding line, set qty=800, unit=SF, scope="Vinyl siding installation"
- ALWAYS look up pricing in the cost book before setting prices — use search_costbook
- Write scope_text in Jorge's style: specific, uses dashes for bullet points, includes quantities and materials
- If Jorge gives you an allowance or lump sum, use unit=LS and qty=1
- Respond briefly — confirm what you updated/added, show the key numbers. Don't be verbose.

${projectInfo ? `## PROJECT\n${projectInfo}\n` : ""}
## PENNEY TRADE RATES
${tradeRates || "(none loaded)"}

${drawingContext ? `## DRAWING CONTEXT (extracted from PDF)\n${drawingContext.substring(0, 6000)}\n` : ""}
${measurementSummary ? `## CURRENT MEASUREMENTS\n${measurementSummary}\n` : ""}
${estimateContext ? `## CURRENT ESTIMATE LINES\n${estimateContext}\n` : ""}`;

    // Build messages from history
    const messages: MessageParam[] = [
      ...conversationHistory.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: message },
    ];

    const anthropic = await getAnthropicClient();
    let usedModel = CLAUDE_OPUS_FALLBACK[0];

    // Stream response with tool loop
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          let currentMessages = [...messages];
          let fullResponse = "";
          const MAX_ROUNDS = 6;
          let totalInputTokens = 0;
          let totalOutputTokens = 0;

          for (let round = 0; round < MAX_ROUNDS; round++) {
            let response: Anthropic.Message;
            try {
              response = await anthropic.messages.create({
                model: usedModel,
                max_tokens: 4096,
                system: systemPrompt,
                messages: currentMessages,
                tools: TAKEOFF_CHAT_TOOLS,
              });
            } catch {
              if (usedModel !== CLAUDE_OPUS_FALLBACK[1]) {
                usedModel = CLAUDE_OPUS_FALLBACK[1];
                response = await anthropic.messages.create({
                  model: usedModel,
                  max_tokens: 4096,
                  system: systemPrompt,
                  messages: currentMessages,
                  tools: TAKEOFF_CHAT_TOOLS,
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

            // Auto-execute ALL tools (estimating tools are safe — user sees results in the estimate)
            for (const tool of toolUseBlocks) {
              const label = isReadTool(tool.name) ? `Looking up ${tool.name.replace(/_/g, " ")}...` : `Updating estimate...`;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_status", tool: tool.name, label })}\n\n`));
            }

            const toolResults = await Promise.all(
              toolUseBlocks.map(async (tool) => {
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

            // Notify about estimate changes
            for (const tool of toolUseBlocks) {
              if (tool.name === "update_estimate_line_item" || tool.name === "add_estimate_line_item") {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "estimate_updated" })}\n\n`));
              }
            }

            currentMessages = [
              ...currentMessages,
              { role: "assistant" as const, content: response.content as ContentBlockParam[] },
              {
                role: "user" as const,
                content: toolResults.map(r => ({
                  type: "tool_result" as const,
                  tool_use_id: r.tool_use_id,
                  content: r.result,
                })),
              },
            ];

            if (response.stop_reason !== "tool_use") break;
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
