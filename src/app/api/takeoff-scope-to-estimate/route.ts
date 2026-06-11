import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_OPUS_FALLBACK, nowStamp, logAiUsage } from "@/lib/ai/claude";
import { lineItemFinancials, lineCost, linePrice } from "@/lib/estimates/line-item-financials";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/takeoff-scope-to-estimate
 *
 * Phase 3 — Estimator AI.
 *
 * The takeoff stage (separate) already did the only drawing read. This
 * endpoint takes the scope output from that stage and runs ONE Opus call
 * that synthesizes Jorge's historical data (trade_rates, past similar
 * projects, this project's draft budget notes) into priced line items
 * with per-line reasoning. No heuristics, no competing logic — one AI
 * brain, one consistent story.
 *
 * Line items then become the spine for bids & quotes (separate flow).
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
      mode = "replace",
      estimateName = "Takeoff Estimate",
      // Optional: target a specific estimate (option) rather than latest.
      // Powers the multi-option picker — when set, the AI synthesizes prices
      // into THAT option's line items instead of falling back to "latest".
      estimateId: estimateIdFromBody,
    } = body as {
      projectId: string;
      scopeByTrade: Record<string, ScopeItemPayload[]>;
      tradeOrder: string[];
      tradeLabels: Record<string, string>;
      mode?: "replace" | "append";
      estimateName?: string;
      estimateId?: string;
    };

    if (!projectId || !scopeByTrade || !tradeOrder) {
      return NextResponse.json({ error: "projectId, scopeByTrade, tradeOrder required" }, { status: 400 });
    }

    // ---- 1. Project context (keep scope_of_work for Opus hint, DO NOT overwrite) ----
    const { data: project } = await supabase
      .from("projects")
      .select("id, name, project_type, address, scope_of_work, estimated_value, contract_value")
      .eq("id", projectId)
      .maybeSingle();

    // ---- 2. Similar past projects with their budgets (teaching examples) ----
    const { data: pastProjects } = await supabase
      .from("projects")
      .select("name, project_type, estimated_value, contract_value, scope_of_work")
      .neq("id", projectId)
      .not("scope_of_work", "is", null)
      .not("contract_value", "is", null)
      .order("created_at", { ascending: false })
      .limit(40);

    // Pick up to 5 closest matches on project_type
    const similar = rankSimilarProjects(project?.project_type, pastProjects || []).slice(0, 5);

    // ---- 3. Active trade rates ----
    const { data: tradeRatesRaw } = await supabase
      .from("trade_rates")
      .select("trade_name, unit_type, avg_price, avg_cost")
      .eq("is_active", true);
    const tradeRates = (tradeRatesRaw || []).map(r => ({
      trade_name: r.trade_name,
      unit_type: r.unit_type,
      avg_price: Number(r.avg_price),
      avg_cost: Number(r.avg_cost),
    }));

    // ---- 4. Find or create estimate ----
    //
    // Resolution order:
    //   1. ?estimateId from request body — caller picked a specific option.
    //      Must belong to this project; status must allow writes (draft or
    //      approved-but-not-sent). If the caller targets a sent/contracted
    //      estimate we 409 — they should create a new version, not mutate.
    //   2. Latest version for the project — if it's draft, reuse; else
    //      bump version and create a new draft.
    let estimateId: string;

    if (estimateIdFromBody) {
      const { data: targetEst } = await supabase
        .from("estimates")
        .select("id, project_id, status")
        .eq("id", estimateIdFromBody)
        .maybeSingle();
      if (!targetEst || targetEst.project_id !== projectId) {
        return NextResponse.json({ error: "estimateId not found on this project" }, { status: 404 });
      }
      if (targetEst.status !== "draft" && targetEst.status !== "approved") {
        return NextResponse.json(
          { error: `Cannot write to estimate in status '${targetEst.status}'. Create a new version.` },
          { status: 409 }
        );
      }
      estimateId = targetEst.id;
    } else {
      const { data: latestEstimate } = await supabase
        .from("estimates")
        .select("id, version, status")
        .eq("project_id", projectId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestEstimate && latestEstimate.status === "draft") {
        estimateId = latestEstimate.id;
      } else {
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
            notes: "Generated from takeoff + Estimator AI",
          })
          .select("id")
          .single();
        if (createErr || !newEst) {
          return NextResponse.json({ error: createErr?.message || "Failed to create estimate" }, { status: 500 });
        }
        estimateId = newEst.id;
      }
    }

    // ---- 5. Build a flat, indexed scope list for the Estimator AI ----
    const flatScope: Array<ScopeItemPayload & { _idx: number; _trade: string; _tradeLabel: string }> = [];
    for (const tradeKey of tradeOrder) {
      const items = scopeByTrade[tradeKey] || [];
      const tradeLabel = tradeLabels[tradeKey] || tradeKey;
      for (const it of items) {
        flatScope.push({ ...it, _idx: flatScope.length, _trade: tradeKey, _tradeLabel: tradeLabel });
      }
    }

    // ---- 6. Call the Estimator AI (Opus) ----
    const aiPrices = await runEstimatorAI({
      user,
      project: project ? {
        name: project.name,
        type: project.project_type,
        address: project.address,
        scope_of_work: project.scope_of_work,
      } : null,
      similarProjects: similar,
      tradeRates,
      flatScope,
    });

    // ---- 7. UPSERT one line item per trade (never wipe — line item IDs are ----
    //       the spine that downstream quotes, invoices, phases attach to)
    //
    // Aggregation: for each trade with scope, build a single lump-sum line.
    // Items become bullets in proposal_description; AI per-item prices sum to
    // the trade total. If a line already exists for (estimate_id, trade), we
    // preserve Jorge's pricing (unit_cost/unit_price/total_cost/total_price)
    // and only refresh the scope description and notes.

    const { data: existingLines } = await supabase
      .from("estimate_line_items")
      .select("id, trade, sort_order, unit_cost, cost, client_price, total_cost, total_price, markup_percentage")
      .eq("estimate_id", estimateId);

    const existingByTrade = new Map<string, {
      id: string;
      sort_order: number | null;
      unit_cost: number;
      total_cost: number;
      total_price: number;
      markup_percentage: number;
    }>();
    let maxSortOrder = 0;
    for (const r of existingLines || []) {
      if (r.trade) existingByTrade.set(r.trade, {
        id: r.id as string,
        sort_order: (r.sort_order as number | null) ?? null,
        unit_cost: Number(r.unit_cost || 0),
        // Active columns win over the legacy total_* mirrors
        total_cost: lineCost(r),
        total_price: linePrice(r),
        markup_percentage: Number(r.markup_percentage || 0),
      });
      const so = Number(r.sort_order || 0);
      if (so > maxSortOrder) maxSortOrder = so;
    }

    // Group flat scope by trade
    const tradesWithScope: string[] = [];
    const byTrade = new Map<string, { label: string; items: typeof flatScope }>();
    for (const it of flatScope) {
      if (!byTrade.has(it._trade)) {
        byTrade.set(it._trade, { label: it._tradeLabel, items: [] });
        tradesWithScope.push(it._trade);
      }
      byTrade.get(it._trade)!.items.push(it);
    }

    const lineItemsByTrade: Record<string, string> = {};
    let nextSort = maxSortOrder + 1;
    let totalEstimatePrice = 0;

    for (const tradeKey of tradesWithScope) {
      const group = byTrade.get(tradeKey)!;
      const items = group.items;

      // Sum AI prices across the trade's items
      let aggCost = 0;
      let aggPrice = 0;
      let anyPriced = false;
      let anyNeedsQuote = false;
      const confidences: string[] = [];
      const bullets: string[] = [];
      const noteBits: string[] = [];

      for (const it of items) {
        const ai = aiPrices.get(it._idx);
        if (ai) {
          aggCost += ai.total_cost || 0;
          aggPrice += ai.total_price || 0;
          if (!ai.needsQuote && (ai.total_price ?? 0) > 0) anyPriced = true;
          if (ai.needsQuote) anyNeedsQuote = true;
          confidences.push(ai.confidence || "low");
        } else {
          anyNeedsQuote = true;
        }
        bullets.push(buildProposalDescription(it, group.label));
        if (ai?.reasoning) noteBits.push(`• ${it.description}: ${ai.reasoning}`);
      }

      const proposal = bullets.join("\n");
      const confidenceSummary = confidences.length > 0
        ? (confidences.includes("low") ? "low" : confidences.includes("medium") ? "medium" : "high")
        : "none";
      const needsSubQuote = !anyPriced && anyNeedsQuote;
      const notes = [
        `Estimator AI · ${confidenceSummary} · ${items.length} scope item${items.length === 1 ? "" : "s"}${needsSubQuote ? " — needs sub quote" : ""}`,
        ...noteBits,
      ].join("\n");

      const existing = existingByTrade.get(tradeKey);
      if (existing) {
        // Preserve Jorge's pricing; only refresh scope + notes
        const { error: updErr } = await supabase
          .from("estimate_line_items")
          .update({
            description: group.label,
            proposal_description: proposal,
            notes,
            needs_sub_quote: existing.total_price > 0 ? false : needsSubQuote,
          })
          .eq("id", existing.id);
        if (updErr) {
          return NextResponse.json({ error: `Update failed for ${tradeKey}: ${updErr.message}` }, { status: 500 });
        }
        lineItemsByTrade[tradeKey] = existing.id;
        totalEstimatePrice += existing.total_price;
      } else {
        // Insert new line — use AI pricing aggregated across the trade's items
        const { data: inserted, error: insErr } = await supabase
          .from("estimate_line_items")
          .insert({
            estimate_id: estimateId,
            sort_order: nextSort++,
            description: group.label,
            proposal_description: proposal,
            quantity: 1,
            unit: "LS",
            unit_cost: aggCost,
            ...lineItemFinancials(
              aggCost,
              aggCost > 0 ? Math.round(((aggPrice - aggCost) / aggCost) * 100) : 0,
              aggPrice,
            ),
            is_visible_on_proposal: true,
            trade: tradeKey,
            needs_sub_quote: needsSubQuote,
            source: "takeoff",
            notes,
          })
          .select("id")
          .single();
        if (insErr || !inserted) {
          return NextResponse.json({ error: `Insert failed for ${tradeKey}: ${insErr?.message || "unknown"}` }, { status: 500 });
        }
        lineItemsByTrade[tradeKey] = inserted.id as string;
        totalEstimatePrice += aggPrice;
      }
    }

    void mode; // legacy param — upsert is now the only behavior

    // ---- 8. required_trades summary (do NOT touch scope_of_work) ----
    const requiredTrades = tradeOrder
      .filter(k => (scopeByTrade[k] || []).length > 0)
      .map(k => ({
        trade: tradeLabels[k] || k,
        key: k,
        status: scopeByTrade[k].some(i => i.needsQuote) ? "needs_quotes" : "priced",
      }));
    await supabase
      .from("projects")
      .update({ required_trades: requiredTrades })
      .eq("id", projectId);

    const pricedCount = Array.from(aiPrices.values()).filter(p => p && !p.needsQuote && (p.total_price ?? 0) > 0).length;

    return NextResponse.json({
      success: true,
      estimateId,
      lineItemCount: tradesWithScope.length,
      pricedCount,
      totalEstimatePrice: Math.round(totalEstimatePrice),
      tradeCount: tradeOrder.length,
      lineItemsByTrade,
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
// Estimator AI — the ONLY pricing brain
// ============================================================================

interface EstimatorPricedLine {
  idx: number;
  unit_cost: number;
  unit_price: number;
  total_cost: number;
  total_price: number;
  unit?: string;
  confidence: "high" | "medium" | "low" | "none";
  reasoning: string;
  needsQuote: boolean;
}

async function runEstimatorAI(opts: {
  user: { id: string };
  project: { name?: string; type?: string; address?: string; scope_of_work?: string } | null;
  similarProjects: Array<{ name: string; project_type: string | null; contract_value: number | string | null; scope_of_work: string | null }>;
  tradeRates: Array<{ trade_name: string; unit_type: string; avg_price: number; avg_cost: number }>;
  flatScope: Array<ScopeItemPayload & { _idx: number; _trade: string; _tradeLabel: string }>;
}): Promise<Map<number, EstimatorPricedLine>> {
  const anthropic = await getAnthropicClient();

  const projectBlock = opts.project
    ? `Project: ${opts.project.name || "Unknown"}
Type: ${opts.project.type || "residential"}
Address: ${opts.project.address || "N/A"}
Jorge's draft budget notes (TREAT AS HINT, NOT FINAL):
${opts.project.scope_of_work || "(none)"}`
    : "Project: (no context)";

  const similarBlock = opts.similarProjects.length > 0
    ? opts.similarProjects.map(p =>
        `- ${p.name} (${p.project_type || "?"}) — contract $${Number(p.contract_value || 0).toLocaleString()}\n  Scope: ${String(p.scope_of_work || "").substring(0, 400)}`
      ).join("\n\n")
    : "(no similar past projects)";

  const ratesBlock = opts.tradeRates.length > 0
    ? opts.tradeRates
        .map(r => `  - ${r.trade_name} [${r.unit_type}] — price $${r.avg_price} / cost $${r.avg_cost}`)
        .join("\n")
    : "(none)";

  const scopeBlock = opts.flatScope.map(it => {
    const qty = typeof it.quantity === "number" ? it.quantity : null;
    return `#${it._idx} [${it._tradeLabel}] ${it.description}` +
      (qty ? ` — ${qty} ${it.unit || ""}` : " — qty TBD") +
      (it.materialSpec ? ` — material: ${it.materialSpec}` : "") +
      (it.sourceSheet ? ` (${it.sourceSheet})` : "");
  }).join("\n");

  const systemPrompt = `You are a senior residential construction estimator for Penney Construction on the North Shore of Massachusetts. Current date: ${nowStamp()}.

You are NOT reading drawings. The takeoff has already been completed by another estimator — the scope list below is the authoritative quantities. Your job is pricing.

Output realistic costs and customer prices for each scope line based on:
1. QUANTITIES the takeoff measured (trust them)
2. PENNEY'S OWN TRADE RATES (below) for unit-based work like foundation wall $/LF, slab $/SF, siding $/SF, flooring $/SF, window supply $/ea
3. PAST SIMILAR PROJECTS (below) — when a past project of similar size/scope had a contract total or trade line item, extrapolate to this project's scale
4. THE PROJECT'S DRAFT BUDGET (below) — Jorge's own hint; use as a sanity check but don't copy blindly since it's a draft
5. NORTH SHORE MA LABOR RATES and typical residential markup (cost × 1.30 for price unless trade-specific)

For every line, output your BEST REASONED PRICE. It's OK to extrapolate thoughtfully; it's NOT OK to output zeros everywhere. Only set needsQuote=true when the scope is genuinely unknowable without field investigation (e.g., hidden conditions, custom specs).

${projectBlock}

SIMILAR PAST PROJECTS (use these as calibration):
${similarBlock}

PENNEY TRADE RATES (authoritative per-unit pricing):
${ratesBlock}

SCOPE LINES TO PRICE (indexed):
${scopeBlock}

Output strict JSON (no markdown fences):
{
  "lines": [
    {
      "idx": 0,
      "unit_cost": 185.0,
      "unit_price": 240.0,
      "total_cost": 11100.0,
      "total_price": 14400.0,
      "unit": "LF",
      "confidence": "high" | "medium" | "low",
      "needsQuote": false,
      "reasoning": "Penney Foundation Wall rate $240/LF × 60 LF measured = $14,400"
    }
  ]
}

Rules:
- idx MUST match the scope line number above
- unit_cost and unit_price per unit; total_cost and total_price are the line totals (quantity × unit or lump sum)
- confidence=high when based on an exact trade rate or very similar past project; medium when extrapolated; low when mostly inferred
- reasoning is short (one sentence) and cites the data source
- for lump-sum items, set unit="LS", quantity will be treated as 1
- set needsQuote=true ONLY when you truly can't make a reasoned number — prefer giving a low-confidence number over $0`;

  let responseText = "";
  let usedModel = "";
  for (const model of CLAUDE_OPUS_FALLBACK) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: "user", content: `Price all ${opts.flatScope.length} scope lines above. Respond with valid JSON only.` }],
      });
      usedModel = model;
      if (response.usage) {
        logAiUsage({
          userId: opts.user.id,
          endpoint: "takeoff-scope-to-estimate/estimator",
          model,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          context: `${opts.flatScope.length} lines, ${opts.similarProjects.length} similar projects`,
        });
      }
      responseText = response.content[0]?.type === "text" ? response.content[0].text : "";
      if (responseText) break;
    } catch (err) {
      console.error(`Estimator AI (${model}) error:`, err);
      continue;
    }
  }
  void usedModel;

  if (!responseText) return new Map();

  let jsonStr = responseText;
  const s = jsonStr.indexOf("{");
  const e = jsonStr.lastIndexOf("}");
  if (s !== -1 && e > s) jsonStr = jsonStr.substring(s, e + 1);

  try {
    const parsed = JSON.parse(jsonStr) as { lines?: Array<Partial<EstimatorPricedLine>> };
    const map = new Map<number, EstimatorPricedLine>();
    for (const raw of parsed.lines || []) {
      if (typeof raw.idx !== "number") continue;
      map.set(raw.idx, {
        idx: raw.idx,
        unit_cost: Math.max(0, Number(raw.unit_cost || 0)),
        unit_price: Math.max(0, Number(raw.unit_price || 0)),
        total_cost: Math.max(0, Number(raw.total_cost || 0)),
        total_price: Math.max(0, Number(raw.total_price || 0)),
        unit: raw.unit,
        confidence: (raw.confidence as EstimatorPricedLine["confidence"]) || "low",
        reasoning: String(raw.reasoning || "").slice(0, 500),
        needsQuote: Boolean(raw.needsQuote),
      });
    }
    return map;
  } catch (err) {
    console.error("Estimator AI JSON parse failed:", err, responseText.substring(0, 500));
    return new Map();
  }
}

function rankSimilarProjects(
  thisType: string | null | undefined,
  pastProjects: Array<{ name: string; project_type: string | null; contract_value: number | string | null; scope_of_work: string | null }>
): typeof pastProjects {
  const t = (thisType || "").toLowerCase();
  const scored = pastProjects.map(p => {
    const ptype = (p.project_type || "").toLowerCase();
    let score = 0;
    if (t && ptype === t) score += 10;
    else if (t && ptype && (t.includes(ptype) || ptype.includes(t))) score += 5;
    if (p.contract_value) score += 2;
    if (p.scope_of_work && p.scope_of_work.length > 50) score += 1;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.p);
}

function roundQuantityForUnit(qty: number, unit: string | null | undefined): number {
  const u = (unit || "").toLowerCase();
  if (u === "ea" || u === "each" || u === "count") return Math.round(qty);
  return Math.round(qty * 100) / 100;
}

// ============================================================================
// Types + shared helpers
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
  if (item.sourceSheet) parts.push(`Source: ${item.sourceSheet}${item.sourceDetail ? ` — ${item.sourceDetail}` : ""}`);
  void tradeLabel;
  return parts.join(". ");
}
