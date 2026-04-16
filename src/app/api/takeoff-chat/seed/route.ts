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
  } = await request.json() as {
    projectId: string;
    scopeByTrade: Record<string, ScopeItem[]>;
    tradeOrder: string[];
    tradeLabels: Record<string, string>;
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

    // Check if conversation already exists
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("project_id", projectId)
      .eq("title", chatTitle)
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Already seeded — skip
      seeded.push(tradeKey);
      continue;
    }

    // Create conversation
    const { data: conv } = await supabase
      .from("conversations")
      .insert({
        user_id: user.id,
        project_id: projectId,
        title: chatTitle,
      })
      .select("id")
      .single();

    if (!conv) continue;

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

    // Seed with a system message containing the AI analysis
    const seedContent = `AI Drawing Analysis found the following ${label} scope for this project:\n\n${scopeLines}\n\nThis is from the construction drawings. Review with Jorge to confirm quantities, add screenshots, and build the bid package.`;

    await supabase.from("conversation_messages").insert({
      conversation_id: conv.id,
      role: "assistant",
      content: seedContent,
      metadata: { source: "analysis-seed" },
    });

    seeded.push(tradeKey);
  }

  return NextResponse.json({ seeded, count: seeded.length });
}
