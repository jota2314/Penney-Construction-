/**
 * GET /api/estimate-line-items/[id]
 *
 * Returns a full drill-down of a single estimate line item — screenshots,
 * sub quotes, and the trade chat conversation link. Used by the review
 * page's expandable rows so Ryan can click a line and see everything Jorge
 * gathered for it without leaving the review screen.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteLineItem } from "@/lib/actions/estimates";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  const { data: line } = await supabase
    .from("estimate_line_items")
    .select("id, description, proposal_description, trade, quantity, unit, unit_cost, cost, markup_pct, client_price, total_cost, markup_percentage, total_price, needs_sub_quote, notes, estimate_id")
    .eq("id", id)
    .maybeSingle();
  if (!line) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Find the project that owns this estimate so we can locate screenshots
  const { data: est } = await supabase
    .from("estimates")
    .select("project_id")
    .eq("id", line.estimate_id)
    .maybeSingle();
  const projectId = est?.project_id as string | null;

  // Screenshots live in the bucket keyed first by line item ID, and for
  // older line items also by trade slug. Union both, dedupe by path.
  const screenshots: Array<{ path: string; url: string; name: string }> = [];
  if (projectId) {
    const folderKeys = new Set<string>();
    folderKeys.add(line.id as string);
    if (line.trade) folderKeys.add(String(line.trade));
    const seen = new Set<string>();
    for (const key of folderKeys) {
      try {
        const { data: files } = await supabase.storage
          .from("email-attachments")
          .list(`takeoff-screenshots/${projectId}/${key}`);
        if (!files?.length) continue;
        for (const f of files) {
          const path = `takeoff-screenshots/${projectId}/${key}/${f.name}`;
          if (seen.has(path)) continue;
          seen.add(path);
          const { data: signed } = await supabase.storage
            .from("email-attachments")
            .createSignedUrl(path, 3600);
          if (signed?.signedUrl) {
            screenshots.push({ path, url: signed.signedUrl, name: f.name });
          }
        }
      } catch { /* non-critical */ }
    }
  }

  // Sub quotes linked directly to this line item
  const { data: quotesRaw } = await supabase
    .from("quote_requests")
    .select("id, subcontractor_name, amount, status, document_type, created_at, gmail_message_id, attachment_storage_path, scope_description")
    .eq("estimate_line_item_id", id)
    .order("created_at", { ascending: false });

  // The trade chat conversation tied to this line item (if any)
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, title")
    .eq("estimate_line_item_id", id)
    .maybeSingle();

  return NextResponse.json({
    lineItem: {
      ...line,
      quantity: Number(line.quantity || 0),
      unit_cost: Number(line.unit_cost || 0),
      // Active columns win; legacy total_* values can be stale.
      total_cost: Number(line.cost ?? line.total_cost ?? 0),
      markup_percentage: Number(line.markup_pct ?? line.markup_percentage ?? 0),
      total_price: Number(line.client_price ?? line.total_price ?? 0),
    },
    screenshots,
    quotes: (quotesRaw || []).map(q => ({
      id: q.id as string,
      subcontractor_name: String(q.subcontractor_name || ""),
      amount: q.amount != null ? Number(q.amount) : null,
      status: String(q.status || ""),
      document_type: (q.document_type as string | null) || null,
      created_at: String(q.created_at || ""),
      scope_description: (q.scope_description as string | null) || null,
    })),
    conversationId: conv?.id || null,
    conversationTitle: conv?.title || null,
  });
}

/**
 * DELETE /api/estimate-line-items/[id]
 *
 * Deletes the line item AND any takeoff-chat conversation bound to it.
 * Invoked from the takeoff sidebar's trash button — one delete removes
 * both the estimate row and the chat that grew up around it.
 *
 * Sub-quotes (quote_requests) keep their rows; their estimate_line_item_id
 * FK is ON DELETE SET NULL so they stay as orphaned docs rather than
 * disappearing silently. Screenshots in storage are not deleted — the
 * storage folder is keyed by line_item_id so they become unreachable but
 * recoverable by path if ever needed.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  const { data: line } = await supabase
    .from("estimate_line_items")
    .select("estimate_id")
    .eq("id", id)
    .maybeSingle();
  if (!line) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Delete any conversation (and its messages via cascade) that was keyed
  // to this line item. Do it first — if we deleted the line item first the
  // FK would already be nulled and we'd have to scan by other keys.
  const { data: convs } = await supabase
    .from("conversations")
    .select("id")
    .eq("estimate_line_item_id", id);
  for (const c of convs || []) {
    await supabase
      .from("conversation_messages")
      .delete()
      .eq("conversation_id", c.id as string);
    await supabase
      .from("conversations")
      .delete()
      .eq("id", c.id as string);
  }

  const result = await deleteLineItem(id, line.estimate_id as string);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({ success: true });
}
