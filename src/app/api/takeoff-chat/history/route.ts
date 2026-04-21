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
      .select("id, title, updated_at")
      .eq("project_id", projectId)
      .like("title", "Takeoff - %")
      .order("updated_at", { ascending: false });

    // Get message counts for each conversation
    const conversations = await Promise.all(
      (convs || []).map(async (c) => {
        const { count } = await supabase
          .from("conversation_messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", c.id);
        return { ...c, messageCount: count || 0 };
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

  if (conv.estimate_line_item_id) {
    const { data: li } = await supabase
      .from("estimate_line_items")
      .select("id, description, proposal_description, quantity, unit, unit_cost, total_cost, markup_percentage, total_price, trade, needs_sub_quote, notes")
      .eq("id", conv.estimate_line_item_id)
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
      .eq("estimate_line_item_id", conv.estimate_line_item_id)
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
    lineItemId: conv.estimate_line_item_id || null,
  });
}
