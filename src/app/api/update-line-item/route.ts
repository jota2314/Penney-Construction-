/**
 * POST /api/update-line-item
 *
 * Direct, non-AI update of a single estimate_line_items row. Used by the
 * trade chat's inline pricing card and scope-of-work editor.
 *
 * Recalculates totals server-side from unit_cost × quantity and
 * markup_percentage so the UI can't get them out of sync.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lineItemFinancials } from "@/lib/estimates/line-item-financials";

export const runtime = "nodejs";

interface Body {
  line_item_id: string;
  unit_cost?: number;
  quantity?: number;
  unit?: string;
  markup_percentage?: number;
  description?: string;
  proposal_description?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.line_item_id) {
    return NextResponse.json({ error: "line_item_id required" }, { status: 400 });
  }

  // Load current row so we can compute totals against whatever the caller
  // DIDN'T change.
  const { data: current, error: fetchErr } = await supabase
    .from("estimate_line_items")
    .select("unit_cost, quantity, unit, markup_pct, markup_percentage, description, proposal_description")
    .eq("id", body.line_item_id)
    .maybeSingle();
  if (fetchErr || !current) {
    return NextResponse.json({ error: fetchErr?.message || "Line item not found" }, { status: 404 });
  }

  const unit_cost = body.unit_cost != null ? Number(body.unit_cost) : Number(current.unit_cost || 0);
  const quantity = body.quantity != null ? Number(body.quantity) : Number(current.quantity || 1);
  const unit = body.unit ?? current.unit;
  const markup_percentage = body.markup_percentage != null
    ? Number(body.markup_percentage)
    : Number(current.markup_pct ?? current.markup_percentage ?? 0);
  const description = body.description != null ? String(body.description) : current.description;
  const proposal_description = body.proposal_description != null
    ? String(body.proposal_description)
    : current.proposal_description;

  const total_cost = Math.round(unit_cost * quantity * 100) / 100;
  const total_price = Math.round(total_cost * (1 + markup_percentage / 100) * 100) / 100;

  const { error: updErr } = await supabase
    .from("estimate_line_items")
    .update({
      unit_cost,
      quantity,
      unit,
      ...lineItemFinancials(total_cost, markup_percentage, total_price),
      description,
      proposal_description,
    })
    .eq("id", body.line_item_id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    unit_cost,
    quantity,
    unit,
    markup_percentage,
    total_cost,
    total_price,
    description,
    proposal_description,
  });
}
