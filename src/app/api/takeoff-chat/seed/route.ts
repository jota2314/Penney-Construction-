/**
 * POST /api/takeoff-chat/seed
 *
 * After AI full analysis, seed one conversation per trade found in the drawings.
 * Each conversation gets a system message with the scope items for that trade,
 * so the AI already has context when the user opens the chat.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface ScopeItem {
  description: string;
  quantity: number | null;
  unit: string | null;
  materialSpec?: string;
  confidence: string;
  needsQuote: boolean;
  notes?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const {
    projectId,
    scopeByTrade,
    tradeOrder,
    tradeLabels,
    lineItemsByTrade,
  } = await request.json() as {
    projectId: string;
    scopeByTrade: Record<string, ScopeItem[]>;
    tradeOrder: string[];
    tradeLabels: Record<string, string>;
    lineItemsByTrade?: Record<string, string>;
  };

  if (!projectId || !tradeOrder?.length) {
    return NextResponse.json({ error: "projectId and tradeOrder required" }, { status: 400 });
  }

  const seeded: string[] = [];

  for (const tradeKey of tradeOrder) {
    const label = tradeLabels?.[tradeKey] || tradeKey;
    const items = scopeByTrade?.[tradeKey] || [];
    if (items.length === 0) continue;

    const chatTitle = `Takeoff - ${label}`;
    const lineItemId = lineItemsByTrade?.[tradeKey] || null;

    // Find existing conversation for this trade
    const { data: existing } = await supabase
      .from("conversations")
      .select("id, estimate_line_item_id")
      .eq("project_id", projectId)
      .eq("title", chatTitle)
      .limit(1)
      .maybeSingle();

    // Format scope items into a readable summary
    const scopeLines = items.map(it => {
      let line = `- ${it.description}`;
      if (it.quantity != null && it.quantity > 0) {
        line += ` — ${it.quantity} ${it.unit || ""}`;
      } else if (it.needsQuote) {
        line += " — needs sub quote";
      }
      if (it.materialSpec) line += ` (${it.materialSpec})`;
      if (it.confidence && it.confidence !== "high") line += ` [${it.confidence} confidence]`;
      return line;
    }).join("\n");

    let conversationId: string;

    if (existing) {
      conversationId = existing.id as string;
      // Backfill the line item link if missing
      if (lineItemId && !existing.estimate_line_item_id) {
        await supabase
          .from("conversations")
          .update({ estimate_line_item_id: lineItemId })
          .eq("id", conversationId);
      }
      // Append a fresh re-analysis message — don't wipe the conversation
      const reanalysisContent = `Re-analysis of drawings — updated ${label} scope:\n\n${scopeLines}\n\nLine item on estimate refreshed. Prior pricing preserved. Review and adjust if needed.`;
      await supabase.from("conversation_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: reanalysisContent,
        metadata: { source: "analysis-reseed" },
      });
    } else {
      // New conversation — create and seed
      const { data: conv } = await supabase
        .from("conversations")
        .insert({
          user_id: user.id,
          project_id: projectId,
          title: chatTitle,
          estimate_line_item_id: lineItemId,
        })
        .select("id")
        .single();

      if (!conv) continue;
      conversationId = conv.id as string;

      const seedContent = `AI Drawing Analysis found the following ${label} scope for this project:\n\n${scopeLines}\n\nThis is from the construction drawings. Review with Jorge to confirm quantities, add screenshots, and build the bid package.`;

      await supabase.from("conversation_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: seedContent,
        metadata: { source: "analysis-seed" },
      });
    }

    seeded.push(tradeKey);
  }

  return NextResponse.json({ seeded, count: seeded.length });
}
