import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const trade = url.searchParams.get("trade");
  const tradeLabel = url.searchParams.get("tradeLabel");
  const listAll = url.searchParams.get("listAll");

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // ── List all trade conversations for the trade picker ──────
  if (listAll === "true") {
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, title, updated_at, estimate_line_item_id")
      .eq("project_id", projectId)
      .like("title", "Takeoff - %")
      .order("updated_at", { ascending: false });

    // Pull all line items for this project's latest estimate so we can
    // decorate each conversation card with pricing + quote status without
    // N+1 round trips.
    const { data: latestEst } = await supabase
      .from("estimates")
      .select("id")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const linesByTrade = new Map<string, {
      id: string;
      trade: string;
      total_cost: number;
      total_price: number;
      needs_sub_quote: boolean;
    }>();
    const linesById = new Map<string, {
      id: string;
      trade: string;
      total_cost: number;
      total_price: number;
      needs_sub_quote: boolean;
    }>();
    if (latestEst) {
      const { data: lines } = await supabase
        .from("estimate_line_items")
        .select("id, trade, total_cost, total_price, needs_sub_quote")
        .eq("estimate_id", latestEst.id);
      for (const l of lines || []) {
        const normalized = {
          id: l.id as string,
          trade: String(l.trade || ""),
          total_cost: Number(l.total_cost || 0),
          total_price: Number(l.total_price || 0),
          needs_sub_quote: Boolean(l.needs_sub_quote),
        };
        linesById.set(normalized.id, normalized);
        if (normalized.trade) linesByTrade.set(normalized.trade, normalized);
      }
    }

    // Count quotes received per line item
    const lineItemIds = [...linesById.keys()];
    const quoteCounts = new Map<string, number>();
    if (lineItemIds.length > 0) {
      const { data: q } = await supabase
        .from("quote_requests")
        .select("estimate_line_item_id")
        .in("estimate_line_item_id", lineItemIds);
      for (const row of q || []) {
        const id = row.estimate_line_item_id as string | null;
        if (id) quoteCounts.set(id, (quoteCounts.get(id) || 0) + 1);
      }
    }

    // Get message counts + attach line item data for each conversation
    const conversations = await Promise.all(
      (convs || []).map(async (c) => {
        const { count } = await supabase
          .from("conversation_messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", c.id);

        // Resolve the line item: prefer the bound ID, else match by trade
        // derived from the chat title ("Takeoff - {Label}")
        let line = null as typeof linesById extends Map<string, infer V> ? V | null : never;
        if (c.estimate_line_item_id) {
          line = linesById.get(c.estimate_line_item_id as string) || null;
        }
        if (!line && typeof c.title === "string") {
          const label = c.title.replace(/^Takeoff - /, "").trim().toLowerCase();
          // trade keys are slug-like — match loosely
          for (const [trade, v] of linesByTrade) {
            if (trade.toLowerCase() === label.replace(/\s+/g, "_") || trade.toLowerCase() === label) {
              line = v;
              break;
            }
          }
        }

        const quotesCount = line ? (quoteCounts.get(line.id) || 0) : 0;

        return {
          id: c.id,
          title: c.title,
          updated_at: c.updated_at,
          messageCount: count || 0,
          lineItem: line ? {
            id: line.id,
            total_cost: line.total_cost,
            total_price: line.total_price,
            needs_sub_quote: line.needs_sub_quote,
          } : null,
          quotesCount,
        };
      })
    );

    return NextResponse.json({ conversations });
  }

  // ── Load a specific trade conversation ─────────────────────
  const chatTitle = trade
    ? `Takeoff - ${tradeLabel || trade}`
    : "Takeoff Estimating";

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, estimate_line_item_id")
    .eq("project_id", projectId)
    .eq("title", chatTitle)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conv) {
    return NextResponse.json({ conversationId: null, messages: [], lineItem: null, quotes: [] });
  }

  const { data: messages } = await supabase
    .from("conversation_messages")
    .select("role, content")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: true })
    .limit(100);

  // Load the line item bound to this trade chat (pricing card data)
  let lineItem = null;
  let quotes: Array<{
    id: string;
    subcontractor_name: string;
    amount: number | null;
    status: string;
    document_type: string | null;
  }> = [];

  // Backfill: older chats (created before the line-item-binding migration)
  // have estimate_line_item_id = null. If this chat is for a specific trade
  // and the project has a draft estimate with a row for that trade, bind it
  // now so the pricing card renders.
  let boundLineItemId = conv.estimate_line_item_id as string | null;
  if (!boundLineItemId && trade) {
    const { data: est } = await supabase
      .from("estimates")
      .select("id")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (est) {
      const { data: match } = await supabase
        .from("estimate_line_items")
        .select("id")
        .eq("estimate_id", est.id)
        .eq("trade", trade)
        .limit(1)
        .maybeSingle();
      if (match) {
        boundLineItemId = match.id as string;
        await supabase
          .from("conversations")
          .update({ estimate_line_item_id: boundLineItemId })
          .eq("id", conv.id);
      }
    }
  }

  if (boundLineItemId) {
    const { data: li } = await supabase
      .from("estimate_line_items")
      .select("id, description, proposal_description, quantity, unit, unit_cost, total_cost, markup_percentage, total_price, trade, needs_sub_quote, notes")
      .eq("id", boundLineItemId)
      .maybeSingle();
    if (li) {
      lineItem = {
        ...li,
        quantity: Number(li.quantity || 0),
        unit_cost: Number(li.unit_cost || 0),
        total_cost: Number(li.total_cost || 0),
        markup_percentage: Number(li.markup_percentage || 0),
        total_price: Number(li.total_price || 0),
      };
    }

    const { data: q } = await supabase
      .from("quote_requests")
      .select("id, subcontractor_name, amount, status, document_type")
      .eq("estimate_line_item_id", boundLineItemId)
      .order("created_at", { ascending: false });
    quotes = (q || []).map(r => ({
      id: r.id as string,
      subcontractor_name: String(r.subcontractor_name || ""),
      amount: r.amount != null ? Number(r.amount) : null,
      status: String(r.status || ""),
      document_type: (r.document_type as string | null) || null,
    }));
  }

  return NextResponse.json({
    conversationId: conv.id,
    messages: messages || [],
    lineItem,
    quotes,
    lineItemId: boundLineItemId,
  });
}
