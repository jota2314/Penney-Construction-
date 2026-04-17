/**
 * POST /api/takeoff-chat
 *
 * Per-trade estimating AI for the takeoff viewer.
 * When `trade` is provided: scoped to that one trade (focused prompt, filtered rates/lines, fewer tools).
 * When `trade` is absent: backward-compatible generic estimating chat.
 */

import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, nowStamp, logAiUsage } from "@/lib/ai/claude";
import { ALL_TOOLS, TAKEOFF_CHAT_TOOLS, isReadTool } from "@/lib/ai/shared-tools";
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
      trade,
      tradeLabel,
      images = [],
    } = await request.json() as {
      message: string;
      projectId?: string;
      conversationId?: string;
      drawingContext?: string;
      measurementSummary?: string;
      trade?: string;
      tradeLabel?: string;
      images?: Array<{ base64: string; mediaType: string }>;
    };

    if (!message && images.length === 0) return new Response("Message or image required", { status: 400 });

    // ── Conversation title based on trade ─────────────────────
    const chatTitle = trade
      ? `Takeoff - ${tradeLabel || trade}`
      : "Takeoff Estimating";

    // ── Conversation persistence ──────────────────────────────
    let convId = incomingConvId || null;
    let conversationHistory: Array<{ role: string; content: string }> = [];

    try {
      if (!convId && projectId) {
        const { data: existing } = await supabase
          .from("conversations")
          .select("id")
          .eq("project_id", projectId)
          .eq("title", chatTitle)
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
              title: chatTitle,
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
            title: chatTitle,
          })
          .select("id")
          .single();
        if (conv) convId = conv.id;
      }

      if (convId) {
        await supabase.from("conversation_messages").insert({
          conversation_id: convId,
          role: "user",
          content: message || "[screenshot]",
          source: "text",
        });

        const { data: history } = await supabase
          .from("conversation_messages")
          .select("role, content")
          .eq("conversation_id", convId)
          .order("created_at", { ascending: true })
          .limit(20);

        conversationHistory = history || [];
      }
    } catch { /* non-critical */ }

    // ── Save screenshots (scoped to trade folder) ────────────
    const savedImagePaths: string[] = [];
    if (images.length > 0 && projectId) {
      const tradeFolder = trade || "general";
      for (let i = 0; i < images.length; i++) {
        try {
          const img = images[i];
          const ext = img.mediaType.split("/")[1] || "png";
          const storagePath = `takeoff-screenshots/${projectId}/${tradeFolder}/${Date.now()}_${i}.${ext}`;
          const buffer = Buffer.from(img.base64, "base64");
          const { error } = await supabase.storage
            .from("email-attachments")
            .upload(storagePath, buffer, { contentType: img.mediaType });
          if (!error) {
            savedImagePaths.push(storagePath);
          }
        } catch { /* non-critical */ }
      }
    }

    // ── Load previously saved screenshots for this trade ─────
    let existingScreenshots: string[] = [];
    if (trade && projectId) {
      try {
        const { data: files } = await supabase.storage
          .from("email-attachments")
          .list(`takeoff-screenshots/${projectId}/${trade}`);
        if (files?.length) {
          existingScreenshots = files.map(f => `takeoff-screenshots/${projectId}/${trade}/${f.name}`);
        }
      } catch { /* non-critical */ }
    }
    const allScreenshots = [...new Set([...existingScreenshots, ...savedImagePaths])];

    // ── Load trade rates (filtered when trade is set) ────────
    let ratesQuery = supabase
      .from("trade_rates")
      .select("trade_name, unit_type, avg_price, avg_cost")
      .eq("is_active", true);

    if (trade) {
      // Fuzzy match: trade slug "exterior_doors" → search for "exterior door"
      const searchTerm = (tradeLabel || trade).replace(/_/g, " ");
      ratesQuery = ratesQuery.ilike("trade_name", `%${searchTerm}%`);
    }

    const { data: tradeRatesRaw } = await ratesQuery;
    const tradeRates = (tradeRatesRaw || [])
      .map(r => `  ${r.trade_name} [${r.unit_type}] — cost $${r.avg_cost} / price $${r.avg_price}`)
      .join("\n");

    // ── Load project info ────────────────────────────────────
    let projectInfo = "";
    let projectName = "";
    if (projectId) {
      const { data: project } = await supabase
        .from("projects")
        .select("name, project_type, address, scope_of_work")
        .eq("id", projectId)
        .single();
      if (project) {
        projectName = project.name;
        projectInfo = `Project: ${project.name}\nType: ${project.project_type || "residential"}\nAddress: ${project.address || "N/A"}\nJorge's draft budget notes:\n${project.scope_of_work || "(none)"}`;
      }
    }

    // ── Load existing estimate lines (filtered by trade) ─────
    let estimateLines = "";
    if (projectId) {
      try {
        const { data: estimates } = await supabase
          .from("estimates")
          .select("id")
          .eq("project_id", projectId)
          .in("status", ["draft", "approved"])
          .order("version", { ascending: false })
          .limit(1);

        if (estimates?.[0]) {
          let lineQuery = supabase
            .from("estimate_line_items")
            .select("id, description, scope_text, quantity, unit, total_cost, total_price, trade")
            .eq("estimate_id", estimates[0].id)
            .order("sort_order");

          if (trade) {
            lineQuery = lineQuery.ilike("trade", `%${(tradeLabel || trade).replace(/_/g, " ")}%`);
          }

          const { data: lines } = await lineQuery;
          if (lines?.length) {
            estimateLines = lines.map(l =>
              `- [${l.id}] ${l.description} | ${l.quantity ?? "?"} ${l.unit || ""} | cost $${l.total_cost ?? "?"} | price $${l.total_price ?? "?"}${l.scope_text ? ` | scope: ${l.scope_text.substring(0, 120)}` : ""}`
            ).join("\n");
          }
        }
      } catch { /* non-critical */ }
    }

    // ── Build system prompt ──────────────────────────────────
    const displayTrade = tradeLabel || trade || "";
    const systemPrompt = trade
      ? buildTradePrompt({ displayTrade, trade, projectInfo, projectName, tradeRates, estimateLines, drawingContext, measurementSummary, savedImagePaths, allScreenshots })
      : buildGenericPrompt({ projectInfo, tradeRates, drawingContext, measurementSummary, savedImagePaths, estimateLines });

    // ── Choose tool set ──────────────────────────────────────
    const tools = trade ? TAKEOFF_CHAT_TOOLS : ALL_TOOLS;

    // ── Build messages from history ──────────────────────────
    const historyMessages: MessageParam[] = conversationHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    let userContent: MessageParam["content"];
    if (images.length > 0) {
      const contentBlocks: ContentBlockParam[] = [];
      for (const img of images) {
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: img.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: img.base64 },
        } as ContentBlockParam);
      }
      contentBlocks.push({ type: "text", text: message || `What do you see in this drawing for ${displayTrade || "this project"}? Identify scope, quantities, and materials.` });
      userContent = contentBlocks;
    } else {
      userContent = message;
    }

    const messages: MessageParam[] = [
      ...historyMessages,
      { role: "user" as const, content: userContent },
    ];

    const anthropic = await getAnthropicClient();
    let usedModel = "claude-sonnet-4-6";

    // ── Stream response with tool loop ───────────────────────
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
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
                tools,
              });
            } catch {
              if (usedModel !== "claude-sonnet-4-20250514") {
                usedModel = "claude-sonnet-4-20250514";
                response = await anthropic.messages.create({
                  model: usedModel,
                  max_tokens: 2048,
                  system: systemPrompt,
                  messages: currentMessages,
                  tools,
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

            for (const block of textBlocks) {
              if (block.text) {
                fullResponse += block.text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`));
              }
            }

            if (toolUseBlocks.length === 0 || response.stop_reason !== "tool_use") break;

            const ESTIMATING_AUTO = new Set(["update_estimate_line_item", "add_estimate_line_item", "generate_estimate", "generate_proposal", "generate_change_order_pdf", "generate_financial_report", "generate_bid_package"]);
            const autoTools = toolUseBlocks.filter(t => isReadTool(t.name) || ESTIMATING_AUTO.has(t.name));
            const approvalTools = toolUseBlocks.filter(t => !isReadTool(t.name) && !ESTIMATING_AUTO.has(t.name));

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

            const DOC_GEN_TOOLS = new Set(["generate_proposal", "generate_estimate", "generate_bid_package", "generate_change_order_pdf", "generate_financial_report"]);
            for (let ti = 0; ti < autoTools.length; ti++) {
              if (!DOC_GEN_TOOLS.has(autoTools[ti].name)) continue;
              try {
                const parsed = JSON.parse(autoResults[ti].result);
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
              context: projectId ? `project:${projectId}${trade ? `:${trade}` : ""}` : undefined,
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

// ── Trade-scoped system prompt ───────────────────────────────
function buildTradePrompt(opts: {
  displayTrade: string;
  trade: string;
  projectInfo: string;
  projectName: string;
  tradeRates: string;
  estimateLines: string;
  drawingContext: string;
  measurementSummary: string;
  savedImagePaths: string[];
  allScreenshots: string[];
}): string {
  const { displayTrade, trade, projectInfo, projectName, tradeRates, estimateLines, drawingContext, measurementSummary, savedImagePaths, allScreenshots } = opts;
  return `You are the ${displayTrade} estimator for Penney Construction — a residential GC on the North Shore of Massachusetts. ${nowStamp()}

You're working on **${displayTrade}** for ${projectName || "this project"}. Your job:
1. Help Jorge gather all measurements, screenshots, and scope for ${displayTrade}
2. Build/update estimate line items for ${displayTrade} using real cost book pricing
3. When the scope is complete, generate a bid package PDF to send to the sub

## HOW TO WORK
- When Jorge describes scope or shows you drawings → update or add estimate lines for ${displayTrade}
- ALWAYS use search_costbook to look up Penney's real unit prices before setting prices
- Default markup: cost x 1.30 = client price, unless Jorge says otherwise
- Write scope_text in Jorge's style: specific, dashes for bullet points, includes quantities and materials
- NEVER put unit pricing in descriptions or scope_text (no "$X/sqft", no "at $Y per LF"). Clients see these. Only describe WHAT is being done — materials, quantities, specs. The pricing goes in the numeric columns only.
- If Jorge gives an allowance or lump sum, use unit=LS and qty=1
- Check EXISTING ESTIMATE LINES below before adding — don't create duplicates

## BID PACKAGE WORKFLOW
- When Jorge says "send this to a sub" or "bid this out" → use generate_bid_package with trade="${trade}"
- Include all saved screenshots in the bid package using screenshot_paths
- To find subs for ${displayTrade}, use search_subcontractors
- For emails: ALWAYS use draft_email first so Jorge can review

## RULES
- ONLY work on ${displayTrade}. If Jorge mentions a different trade, tell him to switch to that trade's chat.
- Respond briefly — confirm what you did, show key numbers. Don't be verbose.
- NEVER say "I can't render a PDF" — you have tools that generate and deliver them.

${projectInfo ? `## PROJECT\n${projectInfo}\n` : ""}
## ${displayTrade.toUpperCase()} RATES
${tradeRates || "(no matching rates in cost book — use search_costbook to look up)"}

## EXISTING ESTIMATE LINES FOR ${displayTrade.toUpperCase()}
${estimateLines || "(none yet — add lines as Jorge describes scope)"}

${drawingContext ? `## DRAWING CONTEXT (extracted from PDF)\n${drawingContext.substring(0, 3000)}\n` : ""}
${measurementSummary ? `## CURRENT MEASUREMENTS\n${measurementSummary}\n` : ""}
${savedImagePaths.length > 0 ? `## SCREENSHOTS JUST SAVED\n${savedImagePaths.map(p => `- ${p}`).join("\n")}\n` : ""}
${allScreenshots.length > 0 ? `## ALL SAVED SCREENSHOTS FOR ${displayTrade.toUpperCase()} (include these in bid packages)\n${allScreenshots.map(p => `- ${p}`).join("\n")}\n` : ""}`;
}

// ── Generic system prompt (backward compatible) ──────────────
function buildGenericPrompt(opts: {
  projectInfo: string;
  tradeRates: string;
  drawingContext: string;
  measurementSummary: string;
  savedImagePaths: string[];
  estimateLines: string;
}): string {
  const { projectInfo, tradeRates, drawingContext, measurementSummary, savedImagePaths, estimateLines } = opts;
  return `You are the estimating AI for Penney Construction — a residential GC on the North Shore of Massachusetts. ${nowStamp()}

You are Jorge's estimating command center. You help build estimates from drawings AND handle everything around the estimate: proposals, emails, bid packages, quotes, documents.

## ESTIMATING (primary job)
1. Listen to what Jorge describes (scope, quantities, trades, materials, screenshots)
2. Use get_budget_lines to see what line items already exist in the estimate
3. If a line item exists for that trade → use update_estimate_line_item to fill in scope_text, quantity, unit, and pricing
4. If no line item exists → use add_estimate_line_item to create one
5. Use search_costbook to look up Penney's real unit prices for pricing
6. Default markup: cost × 1.30 = client price, unless Jorge says otherwise

## RULES
- When Jorge describes scope → update/add estimate lines immediately
- ALWAYS look up pricing in the cost book before setting prices
- Write scope_text in Jorge's style: specific, dashes for bullet points, includes quantities and materials
- NEVER put unit pricing in descriptions or scope_text (no "$X/sqft", no "at $Y per LF"). Clients see these. Only describe WHAT is being done — materials, quantities, specs. The pricing goes in the numeric columns only.
- If Jorge gives an allowance or lump sum, use unit=LS and qty=1
- For emails: ALWAYS use draft_email first so Jorge can review before sending
- When Jorge says "send this to a sub" or "bid this out" → use generate_bid_package to compile screenshots + scope into a PDF, then email it
- To find subs for a trade, use search_subcontractors with the trade name
- Respond briefly — confirm what you did, show key numbers. Don't be verbose.
- NEVER say "I can't render a PDF" or "I can't display documents" — you have tools that generate and deliver them.

${projectInfo ? `## PROJECT\n${projectInfo}\n` : ""}
## PENNEY TRADE RATES
${tradeRates || "(none loaded)"}

${estimateLines ? `## CURRENT ESTIMATE LINES\n${estimateLines}\n` : ""}
${drawingContext ? `## DRAWING CONTEXT (extracted from PDF)\n${drawingContext.substring(0, 3000)}\n` : ""}
${measurementSummary ? `## CURRENT MEASUREMENTS\n${measurementSummary}\n` : ""}
${savedImagePaths.length > 0 ? `## SCREENSHOTS JUST SAVED\nThese screenshots were saved and can be included in bid packages:\n${savedImagePaths.map(p => `- ${p}`).join("\n")}\n` : ""}`;
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
