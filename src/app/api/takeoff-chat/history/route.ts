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
  const lineItemId = url.searchParams.get("lineItemId");
  const listAll = url.searchParams.get("listAll");

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // ── List all trade conversations for the trade picker ──────
  if (listAll === "true") {
    // Pull every conversation that could belong to the takeoff view —
    // legacy per-trade ("Takeoff - X") AND new per-line-item ("Line: X")
    // chats. New per-line-item chats are keyed by estimate_line_item_id.
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, title, updated_at, estimate_line_item_id")
      .eq("project_id", projectId)
      .or("title.like.Takeoff - %,title.like.Line: %,estimate_line_item_id.not.is.null")
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
    const allLineItems: Array<{
      id: string;
      description: string;
      trade: string;
      total_cost: number;
      total_price: number;
      needs_sub_quote: boolean;
      sort_order: number;
      // Chat decoration — filled in below from conversations + counts
      convId: string | null;
      messageCount: number;
      quotesCount: number;
    }> = [];
    if (latestEst) {
      const { data: lines } = await supabase
        .from("estimate_line_items")
        .select("id, description, trade, total_cost, total_price, needs_sub_quote, sort_order")
        .eq("estimate_id", latestEst.id)
        .order("sort_order", { ascending: true });
      for (const l of lines || []) {
        const normalized = {
          id: l.id as string,
          trade: String(l.trade || ""),
          total_cost: Number(l.total_cost || 0),
          total_price: Number(l.total_price || 0),
          needs_sub_quote: Boolean(l.needs_sub_quote),
        };
        linesById.set(normalized.id, normalized);
        // First-wins so the legacy per-trade chat card still has something
        // to show, but the real totals and the new line-item chat list come
        // from allLineItems (every row, not just one per trade).
        if (normalized.trade && !linesByTrade.has(normalized.trade)) {
          linesByTrade.set(normalized.trade, normalized);
        }
        allLineItems.push({
          id: normalized.id,
          description: String(l.description || ""),
          trade: normalized.trade,
          total_cost: normalized.total_cost,
          total_price: normalized.total_price,
          needs_sub_quote: normalized.needs_sub_quote,
          sort_order: Number(l.sort_order || 0),
          convId: null,
          messageCount: 0,
          quotesCount: 0,
        });
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

    // Decorate every line item with its chat status so the client can
    // render one clickable card per line item (not per trade).
    const convByLineId = new Map<string, { id: string; messageCount: number }>();
    for (const c of conversations) {
      if (c.lineItem?.id) {
        const existing = convByLineId.get(c.lineItem.id);
        // Prefer the conversation with the most messages (covers legacy
        // chats where multiple convs point at the same line item).
        if (!existing || c.messageCount > existing.messageCount) {
          convByLineId.set(c.lineItem.id, { id: c.id, messageCount: c.messageCount });
        }
      }
    }
    for (const li of allLineItems) {
      const bound = convByLineId.get(li.id);
      if (bound) {
        li.convId = bound.id;
        li.messageCount = bound.messageCount;
      }
      li.quotesCount = quoteCounts.get(li.id) || 0;
    }

    return NextResponse.json({ conversations, allLineItems });
  }

  // ── Load a specific conversation ───────────────────────────
  // Preferred: key by estimate_line_item_id (new per-line-item chats).
  // Fallback: key by title (legacy per-trade chats and the generic
  // "Takeoff Estimating" chat).
  type ConvRow = { id: string; estimate_line_item_id: string | null };
  let conv: ConvRow | null = null;

  if (lineItemId) {
    const { data } = await supabase
      .from("conversations")
      .select("id, estimate_line_item_id")
      .eq("project_id", projectId)
      .eq("estimate_line_item_id", lineItemId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    conv = (data as ConvRow | null) ?? null;
  }

  if (!conv) {
    const chatTitle = trade
      ? `Takeoff - ${tradeLabel || trade}`
      : "Takeoff Estimating";

    const { data } = await supabase
      .from("conversations")
      .select("id, estimate_line_item_id")
      .eq("project_id", projectId)
      .eq("title", chatTitle)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    conv = (data as ConvRow | null) ?? null;
  }

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
  let boundLineItemId = (conv.estimate_line_item_id as string | null) || lineItemId;
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

  // Screenshots tied to this trade chat (line item folder + legacy trade folder)
  const screenshots: Array<{ path: string; url: string; name: string }> = [];
  if (projectId) {
    const folderKeys: string[] = [];
    if (boundLineItemId) folderKeys.push(boundLineItemId);
    if (trade) folderKeys.push(trade);
    const seenPaths = new Set<string>();
    for (const key of folderKeys) {
      try {
        const { data: files } = await supabase.storage
          .from("email-attachments")
          .list(`takeoff-screenshots/${projectId}/${key}`);
        if (files?.length) {
          for (const f of files) {
            const path = `takeoff-screenshots/${projectId}/${key}/${f.name}`;
            if (seenPaths.has(path)) continue;
            seenPaths.add(path);
            const { data: signed } = await supabase.storage
              .from("email-attachments")
              .createSignedUrl(path, 3600);
            if (signed?.signedUrl) {
              screenshots.push({ path, url: signed.signedUrl, name: f.name });
            }
          }
        }
      } catch { /* non-critical */ }
    }
  }

  return NextResponse.json({
    conversationId: conv.id,
    messages: messages || [],
    lineItem,
    quotes,
    lineItemId: boundLineItemId,
    screenshots,
  });
}
