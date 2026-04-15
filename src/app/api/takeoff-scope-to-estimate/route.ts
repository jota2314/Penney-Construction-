import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/takeoff-scope-to-estimate
 *
 * Push the scopeByTrade output from the takeoff analyzer directly into
 * estimate_line_items. No intermediate Claude pass — scope items ARE line
 * items (trade, description, qty, unit, needs_sub_quote, source).
 *
 * Side effects:
 *  - Creates an estimate if project has none (or reuses latest draft)
 *  - Replaces or appends line items
 *  - Updates projects.scope_of_work with a formatted per-trade summary
 *  - Updates projects.required_trades JSONB so Scope of Work tile reflects
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await request.json();
    const {
      projectId,
      scopeByTrade,
      tradeOrder,
      tradeLabels,
      mode = "replace",            // "replace" | "append"
      estimateName = "Takeoff Estimate",
    } = body as {
      projectId: string;
      scopeByTrade: Record<string, ScopeItemPayload[]>;
      tradeOrder: string[];
      tradeLabels: Record<string, string>;
      mode?: "replace" | "append";
      estimateName?: string;
    };

    if (!projectId || !scopeByTrade || !tradeOrder) {
      return NextResponse.json({ error: "projectId, scopeByTrade, tradeOrder required" }, { status: 400 });
    }

    // ---- 1. Find or create estimate ----
    const { data: latestEstimate } = await supabase
      .from("estimates")
      .select("id, version, status")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    let estimateId: string;

    if (latestEstimate && latestEstimate.status === "draft") {
      estimateId = latestEstimate.id;
    } else {
      // Create new version
      const nextVersion = (latestEstimate?.version || 0) + 1;
      const { data: newEst, error: createErr } = await supabase
        .from("estimates")
        .insert({
          project_id: projectId,
          version: nextVersion,
          name: estimateName,
          status: "draft",
          markup_percentage: 0,
          total_cost: 0,
          total_price: 0,
          created_by: user.id,
          notes: "Generated from takeoff scope",
        })
        .select("id")
        .single();
      if (createErr || !newEst) {
        return NextResponse.json({ error: createErr?.message || "Failed to create estimate" }, { status: 500 });
      }
      estimateId = newEst.id;
    }

    // ---- 2. Replace or append line items ----
    let startOrder = 0;
    if (mode === "replace") {
      await supabase
        .from("estimate_line_items")
        .delete()
        .eq("estimate_id", estimateId);
    } else {
      const { data: existing } = await supabase
        .from("estimate_line_items")
        .select("sort_order")
        .eq("estimate_id", estimateId)
        .order("sort_order", { ascending: false })
        .limit(1);
      startOrder = (existing && existing[0]?.sort_order ? existing[0].sort_order : 0) + 1;
    }

    // Flatten scopeByTrade to an ordered array using tradeOrder
    const rows: Array<Record<string, unknown>> = [];
    let sortIdx = startOrder;
    for (const tradeKey of tradeOrder) {
      const items = scopeByTrade[tradeKey] || [];
      const tradeLabel = tradeLabels[tradeKey] || tradeKey;
      for (const item of items) {
        const qty = typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
        const unit = item.unit || (item.needsQuote ? "LS" : "ea");
        const description = item.description || `${tradeLabel} scope item`;
        const proposal = buildProposalDescription(item, tradeLabel);
        rows.push({
          estimate_id: estimateId,
          sort_order: sortIdx++,
          description,
          proposal_description: proposal,
          quantity: qty,
          unit,
          unit_cost: 0,
          total_cost: 0,
          markup_percentage: 0,
          total_price: 0,
          is_visible_on_proposal: true,
          trade: tradeKey,
          needs_sub_quote: Boolean(item.needsQuote) || !(typeof item.quantity === "number" && item.quantity > 0),
          source: "takeoff",
          notes: buildInternalNote(item),
        });
      }
    }

    if (rows.length > 0) {
      const { error: insertErr } = await supabase
        .from("estimate_line_items")
        .insert(rows);
      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
    }

    // ---- 3. Update projects.scope_of_work + required_trades ----
    const scopeSummary = buildScopeSummary(scopeByTrade, tradeOrder, tradeLabels);
    const requiredTrades = tradeOrder
      .filter(k => (scopeByTrade[k] || []).length > 0)
      .map(k => ({
        trade: tradeLabels[k] || k,
        key: k,
        status: scopeByTrade[k].some(i => i.needsQuote) ? "needs_quotes" : "priced",
      }));

    await supabase
      .from("projects")
      .update({
        scope_of_work: scopeSummary,
        required_trades: requiredTrades,
      })
      .eq("id", projectId);

    return NextResponse.json({
      success: true,
      estimateId,
      lineItemCount: rows.length,
      tradeCount: tradeOrder.length,
    });
  } catch (err) {
    console.error("takeoff-scope-to-estimate error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Push failed" },
      { status: 500 }
    );
  }
}

// ============================================================================
// Types + formatters
// ============================================================================

interface ScopeItemPayload {
  id?: string;
  trade?: string;
  description: string;
  quantity: number | null;
  unit: string | null;
  materialSpec?: string;
  sourceSheet?: string;
  sourceType?: string;
  sourceDetail?: string;
  computation?: string;
  confidence?: string;
  needsQuote?: boolean;
  notes?: string;
}

function buildProposalDescription(item: ScopeItemPayload, tradeLabel: string): string {
  const parts: string[] = [];
  parts.push(item.description);
  if (item.materialSpec) parts.push(`Material: ${item.materialSpec}`);
  if (typeof item.quantity === "number" && item.quantity > 0 && item.unit) {
    parts.push(`Quantity: ${item.quantity} ${item.unit}`);
  }
  if (item.needsQuote && !(typeof item.quantity === "number" && item.quantity > 0)) {
    parts.push(`(Quantity TBD — sub to quote from plans)`);
  }
  if (item.sourceSheet) parts.push(`Source: ${item.sourceSheet}${item.sourceDetail ? ` — ${item.sourceDetail}` : ""}`);
  void tradeLabel;
  return parts.join(". ");
}

function buildInternalNote(item: ScopeItemPayload): string | null {
  const bits: string[] = [];
  if (item.computation) bits.push(`Computation: ${item.computation}`);
  if (item.confidence) bits.push(`Confidence: ${item.confidence}`);
  if (item.notes) bits.push(item.notes);
  return bits.length > 0 ? bits.join(" · ") : null;
}

function buildScopeSummary(
  scopeByTrade: Record<string, ScopeItemPayload[]>,
  tradeOrder: string[],
  tradeLabels: Record<string, string>
): string {
  const lines: string[] = [];
  for (const key of tradeOrder) {
    const items = scopeByTrade[key] || [];
    if (items.length === 0) continue;
    const label = tradeLabels[key] || key;
    const withQty = items.filter(i => typeof i.quantity === "number" && i.quantity > 0);
    const quoteOnly = items.filter(i => !(typeof i.quantity === "number" && i.quantity > 0));
    const parts: string[] = [];
    for (const it of withQty.slice(0, 4)) {
      parts.push(`${it.description} (${it.quantity} ${it.unit || ""})`.trim());
    }
    if (quoteOnly.length > 0) parts.push(`${quoteOnly.length} line${quoteOnly.length === 1 ? "" : "s"} need quote`);
    lines.push(`${label}: ${parts.join("; ")}`);
  }
  return lines.join("\n");
}
