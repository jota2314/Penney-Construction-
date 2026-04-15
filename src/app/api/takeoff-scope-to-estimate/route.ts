import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_OPUS_FALLBACK, nowStamp, logAiUsage } from "@/lib/ai/claude";

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

    // ---- 7. Replace/append line items with priced rows ----
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

    const rows = flatScope.map((it, i) => {
      const ai = aiPrices.get(it._idx);
      const hasRealQty = typeof it.quantity === "number" && it.quantity > 0;
      const rawQty = hasRealQty ? (it.quantity as number) : 1;
      const qty = roundQuantityForUnit(rawQty, it.unit);
      const unit = ai?.unit || it.unit || (it.needsQuote ? "LS" : "ea");
      const description = it.description || `${it._tradeLabel} scope item`;
      const proposal = buildProposalDescription(it, it._tradeLabel);

      const unit_cost = ai?.unit_cost ?? 0;
      const total_cost = ai?.total_cost ?? 0;
      const unit_price = ai?.unit_price ?? 0;
      const total_price = ai?.total_price ?? 0;
      const confidence = ai?.confidence || "none";
      const reasoning = ai?.reasoning || "Estimator AI did not price this line.";

      const noteBits: string[] = [];
      if (ai) {
        noteBits.push(`Estimator AI · ${confidence} · ${reasoning}`);
      } else {
        noteBits.push(`Not priced — needs sub quote from plans.`);
      }
      if (it.sourceSheet) noteBits.push(`Drawing source: ${it.sourceSheet}`);
      if (it.computation) noteBits.push(`Takeoff math: ${it.computation}`);

      return {
        estimate_id: estimateId,
        sort_order: startOrder + i,
        description,
        proposal_description: proposal,
        quantity: qty,
        unit,
        unit_cost,
        total_cost,
        markup_percentage: 0,
        total_price,
        is_visible_on_proposal: true,
        trade: it._trade,
        needs_sub_quote: !ai || ai.needsQuote === true,
        source: "takeoff",
        notes: noteBits.join(" · "),
      };
    });

    if (rows.length > 0) {
      const { error: insertErr } = await supabase
        .from("estimate_line_items")
        .insert(rows);
      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
    }

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
    const totalEstimatePrice = rows.reduce((s, r) => s + Number(r.total_price || 0), 0);

    return NextResponse.json({
      success: true,
      estimateId,
      lineItemCount: rows.length,
      pricedCount,
      totalEstimatePrice: Math.round(totalEstimatePrice),
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
