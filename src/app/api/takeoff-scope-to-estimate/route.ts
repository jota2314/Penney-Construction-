import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================================
// Pricing lookup — match each scope item to a trade_rate, using Jorge's
// actual historical pricing. Scope key + description keywords determine
// which rate applies. Unit alignment (sqft→sqft, linear_ft→LF) determines
// whether we do per-unit math or treat the rate as a lump sum.
// ============================================================================

interface PriceRule {
  trade: string;
  rateName: string;
  match?: (desc: string, unit: string, qty: number | null) => boolean;
  flat?: boolean; // true = use as lump sum regardless of scope qty (addition-wide rates)
}

const PRICE_RULES: PriceRule[] = [
  // Demolition
  { trade: "demolition", rateName: "Kitchen Gut", match: d => /kitchen/.test(d), flat: true },
  { trade: "demolition", rateName: "Basement Demo", match: d => /basement/.test(d), flat: true },
  { trade: "demolition", rateName: "Full Floor / Area Demo", flat: true },
  { trade: "demolition", rateName: "Siding Removal", match: d => /sid/.test(d), flat: true },
  // Sitework (no direct match — most are each. Fall through.)
  // Concrete
  { trade: "concrete", rateName: "Foundation Wall", match: d => /wall/.test(d) },
  { trade: "concrete", rateName: "4\" Slab on Grade", match: d => /slab/.test(d) },
  { trade: "concrete", rateName: "Foundation Tie-In", match: d => /tie[- ]?in/.test(d), flat: true },
  { trade: "concrete", rateName: "Crawlspace Foundation Package", match: d => /crawl/.test(d), flat: true },
  { trade: "concrete", rateName: "Concrete Cutting (door opening)", match: d => /cut|opening/.test(d), flat: true },
  // Framing
  { trade: "framing", rateName: "Framing — Addition (labor)", match: (d, u) => /addition/.test(d) && (u === "sqft" || u === "sf") },
  { trade: "framing", rateName: "Kitchen Framing", match: d => /kitchen/.test(d), flat: true },
  { trade: "framing", rateName: "Staircase Framing / Rebuild", match: d => /stair/.test(d), flat: true },
  { trade: "framing", rateName: "Bathroom Framing", match: d => /bath/.test(d), flat: true },
  { trade: "framing", rateName: "Front Entry / Porch Framing", match: d => /porch|entry/.test(d), flat: true },
  { trade: "framing", rateName: "Temp Structural Shoring", match: d => /shoring|temp/.test(d), flat: true },
  // LVL / steel
  { trade: "lvl_steel", rateName: "Flush Steel Beam Install", match: d => /steel/.test(d), flat: true },
  // Sheathing — no direct rate, fall through
  // Roofing
  { trade: "roofing", rateName: "Roofing (new shingles)" },
  { trade: "gutters", rateName: "Gutters & Downspouts", flat: true },
  // Windows — per-unit Harvey vinyl by default
  { trade: "windows", rateName: "Window Supply (Harvey vinyl)" },
  // Doors
  { trade: "interior_doors", rateName: "Interior Door (supply + hang)" },
  { trade: "exterior_doors", rateName: "Exterior Door (supply + install)" },
  // Siding
  { trade: "siding", rateName: "Siding (Cedar Impressions)", match: d => /cedar/.test(d) },
  { trade: "siding", rateName: "Siding (vinyl match existing)", match: d => /match existing|vinyl/.test(d), flat: true },
  // Exterior trim
  { trade: "exterior_trim", rateName: "Exterior AZEK Trim", flat: true },
  // Insulation
  { trade: "insulation", rateName: "Addition Insulation (spray foam)", match: d => /addition|spray/.test(d), flat: true },
  { trade: "insulation", rateName: "Hybrid Insulation Package", flat: true },
  { trade: "insulation", rateName: "Kitchen Insulation", match: d => /kitchen/.test(d), flat: true },
  { trade: "insulation", rateName: "Bathroom Insulation", match: d => /bath/.test(d), flat: true },
  // Drywall / blueboard / plaster
  { trade: "drywall", rateName: "Blueboard & Plaster — Kitchen + Addition", match: d => /kitchen|addition/.test(d), flat: true },
  { trade: "drywall", rateName: "Blueboard & Plaster — Kitchen", match: d => /kitchen/.test(d), flat: true },
  { trade: "drywall", rateName: "Blueboard & Plaster — Bathroom", match: d => /bath/.test(d), flat: true },
  { trade: "drywall", rateName: "Blueboard & Plaster — Full House", flat: true },
  // Interior trim / carpentry
  { trade: "interior_trim", rateName: "Finish Carpentry — Kitchen", match: d => /kitchen/.test(d), flat: true },
  { trade: "interior_trim", rateName: "Finish Carpentry — Bathroom (basic)", match: d => /bath/.test(d), flat: true },
  { trade: "interior_trim", rateName: "Finish Carpentry — Full House", flat: true },
  // Flooring
  { trade: "flooring", rateName: "New Red Oak Hardwood", match: d => /red oak|hardwood|oak/.test(d) },
  { trade: "flooring", rateName: "LVP Flooring", match: d => /lvp|vinyl|luxury/.test(d) },
  { trade: "flooring", rateName: "Sand / Stain / Poly Existing", match: d => /match existing|sand|stain|poly/.test(d) },
  // Kitchen
  { trade: "kitchen", rateName: "Kitchen Cabinet Install (labor)", match: d => /cabinet|install/.test(d), flat: true },
  { trade: "kitchen", rateName: "Kitchen Backsplash", match: d => /backsplash/.test(d), flat: true },
  { trade: "kitchen", rateName: "Countertop Allowance", match: d => /counter/.test(d), flat: true },
  { trade: "kitchen", rateName: "Appliance Install", match: d => /appliance/.test(d), flat: true },
  { trade: "kitchen", rateName: "Kitchen + Bath Install (full)", flat: true },
  // Bathroom
  { trade: "bathroom", rateName: "Bathroom Tile (floor + shower)", match: d => /tile/.test(d), flat: true },
  { trade: "bathroom", rateName: "Shower Door (glass)", match: d => /shower door|glass/.test(d), flat: true },
  { trade: "bathroom", rateName: "Half Bath Rough & Finish", match: d => /half/.test(d), flat: true },
  { trade: "bathroom", rateName: "Kitchen + Bath Install (full)", flat: true },
  // Painting
  { trade: "painting", rateName: "Painting — Exterior", match: d => /exterior/.test(d), flat: true },
  { trade: "painting", rateName: "Painting — Kitchen + Multiple Rooms", match: d => /kitchen/.test(d), flat: true },
  { trade: "painting", rateName: "Painting — Single Bathroom", match: d => /bath/.test(d), flat: true },
  { trade: "painting", rateName: "Painting — Full House Interior", flat: true },
  // Electrical
  { trade: "electrical", rateName: "Addition Electrical", match: d => /addition/.test(d), flat: true },
  { trade: "electrical", rateName: "Kitchen Electrical (basic)", match: d => /kitchen/.test(d), flat: true },
  { trade: "electrical", rateName: "Bathroom Electrical", match: d => /bath/.test(d), flat: true },
  { trade: "electrical", rateName: "Electrical Service Upgrade 200A", match: d => /service|200a|panel/.test(d), flat: true },
  { trade: "electrical", rateName: "Full House Electrical (w/ 200A)", flat: true },
  // Plumbing
  { trade: "plumbing", rateName: "Kitchen Plumbing Re-rough", match: d => /kitchen/.test(d), flat: true },
  { trade: "plumbing", rateName: "Full Bath Remodel Plumbing", match: d => /bath/.test(d), flat: true },
  { trade: "plumbing", rateName: "Move Gas Pipe", match: d => /gas/.test(d), flat: true },
  { trade: "plumbing", rateName: "Full House Plumbing (7+ fixtures)", flat: true },
  // HVAC
  { trade: "hvac", rateName: "HVAC — Extend to Addition", match: d => /addition|extend/.test(d), flat: true },
  { trade: "hvac", rateName: "Furnace + Condenser (per system)", match: d => /furnace|condens/.test(d), flat: true },
  { trade: "hvac", rateName: "Full House HVAC Allowance", flat: true },
];

interface TradeRate {
  trade_name: string;
  unit_type: string;
  avg_price: number;
  avg_cost: number;
}

function unitsCompatible(scopeUnit: string | null, rateUnit: string): boolean {
  const s = (scopeUnit || "").toLowerCase();
  const r = rateUnit.toLowerCase();
  if (!s) return false;
  if (s === r) return true;
  if ((s === "sqft" || s === "sf") && r === "sqft") return true;
  if ((s === "lf" || s === "ft") && r === "linear_ft") return true;
  if ((s === "ea" || s === "count") && r === "each") return true;
  return false;
}

function lookupPrice(
  tradeKey: string,
  description: string,
  unit: string | null,
  quantity: number | null,
  tradeRates: TradeRate[]
): {
  unit_cost: number;
  unit_price: number;
  total_cost: number;
  total_price: number;
  matched_rate: string | null;
  final_quantity: number;
  final_unit: string;
} | null {
  const descLower = (description || "").toLowerCase();
  const qty = typeof quantity === "number" && quantity > 0 ? quantity : 1;
  const unitLower = (unit || "").toLowerCase();

  // Find applicable rules for this trade, in order
  const candidates = PRICE_RULES.filter(r => r.trade === tradeKey);
  for (const rule of candidates) {
    if (rule.match && !rule.match(descLower, unitLower, quantity)) continue;
    const rate = tradeRates.find(r => r.trade_name === rule.rateName);
    if (!rate) continue;
    const cost = Number(rate.avg_cost);
    const price = Number(rate.avg_price);
    if (!isFinite(cost) || !isFinite(price)) continue;

    // Unit alignment
    if (!rule.flat && unitsCompatible(unit, rate.unit_type)) {
      // Per-unit math
      return {
        unit_cost: cost,
        unit_price: price,
        total_cost: round2(qty * cost),
        total_price: round2(qty * price),
        matched_rate: rate.trade_name,
        final_quantity: qty,
        final_unit: unit || rate.unit_type,
      };
    }
    // Lump sum — use rate as project total, qty=1
    return {
      unit_cost: cost,
      unit_price: price,
      total_cost: round2(cost),
      total_price: round2(price),
      matched_rate: rate.trade_name,
      final_quantity: 1,
      final_unit: "LS",
    };
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundQuantityForUnit(qty: number, unit: string | null): number {
  const u = (unit || "").toLowerCase();
  if (u === "ea" || u === "each" || u === "count") return Math.round(qty);
  return round2(qty);
}

// ============================================================================
// Parse Jorge's own budget notes out of projects.scope_of_work text.
// Example input:
//   "Excavation ($17.5K+$5K disposal), foundation ($15.5K),
//    framing ($32K+steel beam $8.9K), roofing ($8.5K), electrical
//    (MTP $12K+$4.5K service), windows (Andersen $20K),
//    skylights (4 Velux $6.8K), blueboard/plaster ($8.6K),
//    cabinets install ($6.4K), painting ($7.1K), finish carpentry ($7.5K)"
// Output:
//   Map { "sitework" => 22500, "concrete" => 15500, "framing" => 32000,
//         "lvl_steel" => 8900, "roofing" => 15300 (8500 + 6800 skylights),
//         "electrical" => 16500, "windows" => 20000,
//         "drywall" => 8600, "kitchen" => 6400, "painting" => 7100,
//         "interior_trim" => 7500 }
// ============================================================================

function parseScopeBudget(text: string | null | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!text) return map;

  // Split on commas/periods so each clause is a "trade (dollars)" unit
  const clauses = text.split(/[,.;]/).map(s => s.trim()).filter(Boolean);

  for (const clause of clauses) {
    // Find "word-ish label" before a "(... $ ...)" group
    const parenMatch = clause.match(/^(.+?)\s*\(([^)]*\$[^)]*)\)/);
    if (!parenMatch) {
      // Sometimes the clause is "foundation $15K" with no parens
      const bareMatch = clause.match(/^(.+?)\s*\$([\d.,]+)\s*([kKmM])?/);
      if (bareMatch) {
        const slug = mapTradeWordToSlug(bareMatch[1]);
        if (!slug) continue;
        const amt = parseDollarAmount(bareMatch[2], bareMatch[3]);
        if (amt > 0) map.set(slug, (map.get(slug) || 0) + amt);
      }
      continue;
    }

    const rawWord = parenMatch[1].trim();
    const parenContent = parenMatch[2];

    // Base slug from the word before the parens
    const baseSlug = mapTradeWordToSlug(rawWord);

    // Sum all $amounts inside parens, but also honor in-paren sub-trade tags
    // like "steel beam $8.9K" — split those out to lvl_steel
    const segments = parenContent.split("+").map(s => s.trim());
    for (const seg of segments) {
      const dollarMatch = seg.match(/\$([\d.,]+)\s*([kKmM])?/);
      if (!dollarMatch) continue;
      const amt = parseDollarAmount(dollarMatch[1], dollarMatch[2]);
      if (amt <= 0) continue;

      // Text before the $ in this segment can indicate a sub-trade
      // (e.g., "steel beam $8.9K"). Try to extract a sub-trade.
      const beforeDollar = seg.slice(0, dollarMatch.index || 0).trim();
      let segSlug: string | null = null;
      if (beforeDollar.length > 2) segSlug = mapTradeWordToSlug(beforeDollar);
      const slug = segSlug || baseSlug;
      if (!slug) continue;
      map.set(slug, (map.get(slug) || 0) + amt);
    }
  }

  return map;
}

function parseDollarAmount(numStr: string, suffix?: string): number {
  let num = parseFloat(numStr.replace(/,/g, ""));
  if (!isFinite(num) || num <= 0) return 0;
  const s = (suffix || "").toLowerCase();
  if (s === "k") num *= 1000;
  else if (s === "m") num *= 1_000_000;
  return num;
}

function mapTradeWordToSlug(word: string): string | null {
  const w = (word || "").toLowerCase();
  if (!w) return null;
  if (/demo|demolition|gut/.test(w)) return "demolition";
  if (/excavat|disposal|site\s*work|grading|backfill/.test(w)) return "sitework";
  if (/steel\s*beam|\bsteel\b(?!\s*door)/.test(w)) return "lvl_steel";
  if (/\blvl\b|psl|engineered/.test(w)) return "lvl_steel";
  if (/foundation|concrete|footing|slab|crawl/.test(w)) return "concrete";
  if (/framing|frame\b/.test(w)) return "framing";
  if (/sheath/.test(w)) return "sheathing";
  if (/shingle|roofing\b|roof\b/.test(w)) return "roofing";
  if (/skylight/.test(w)) return "roofing";
  if (/gutter/.test(w)) return "gutters";
  if (/siding/.test(w)) return "siding";
  if (/finish\s*carpentry|int.*trim|base|casing|crown/.test(w)) return "interior_trim";
  if (/ext.*trim|azek|fascia|soffit/.test(w)) return "exterior_trim";
  if (/windows?\b/.test(w)) return "windows";
  if (/ext.*door|exterior\s*door|entry\s*door|slider/.test(w)) return "exterior_doors";
  if (/int.*door|interior\s*door/.test(w)) return "interior_doors";
  if (/insulation|foam|cellulose|fiberglass/.test(w)) return "insulation";
  if (/blueboard|plaster|drywall|gwb|sheetrock/.test(w)) return "drywall";
  if (/cabinet|kitchen\s*install/.test(w)) return "kitchen";
  if (/kitchen/.test(w)) return "kitchen";
  if (/tile|bath|shower/.test(w)) return "bathroom";
  if (/flooring|floor\b|hardwood|tile\s*floor/.test(w)) return "flooring";
  if (/paint/.test(w)) return "painting";
  if (/fireplace|hearth|mantel/.test(w)) return "framing";
  if (/electrical|electric|wiring|service/.test(w)) return "electrical";
  if (/plumbing|plumb/.test(w)) return "plumbing";
  if (/hvac|heat|a\/?c|mechanical|furnace/.test(w)) return "hvac";
  return null;
}

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

    // ---- 0. Load the project's existing budget notes (authoritative pricing) ----
    const { data: projectRow } = await supabase
      .from("projects")
      .select("scope_of_work")
      .eq("id", projectId)
      .maybeSingle();
    const budgetMap = parseScopeBudget(projectRow?.scope_of_work);

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

    // ---- Load trade rates for pricing lookup ----
    const { data: tradeRatesRaw } = await supabase
      .from("trade_rates")
      .select("trade_name, unit_type, avg_price, avg_cost")
      .eq("is_active", true);
    const tradeRates: TradeRate[] = (tradeRatesRaw || []).map(r => ({
      trade_name: r.trade_name,
      unit_type: r.unit_type,
      avg_price: Number(r.avg_price),
      avg_cost: Number(r.avg_cost),
    }));

    // Flatten scopeByTrade to an ordered array using tradeOrder
    const rows: Array<Record<string, unknown>> = [];
    let sortIdx = startOrder;
    let pricedCount = 0;
    let budgetMatchedCount = 0;
    for (const tradeKey of tradeOrder) {
      const items = scopeByTrade[tradeKey] || [];
      const tradeLabel = tradeLabels[tradeKey] || tradeKey;
      // Project-budget takes priority over trade_rates. If Jorge wrote a
      // number for this trade in scope_of_work, that's the authoritative
      // total for the trade. Put it on the first line; zero the rest with
      // a note pointing at the total.
      const tradeBudget = budgetMap.get(tradeKey) || 0;
      let budgetApplied = false;

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const isFirstInTrade = idx === 0;
        const hasRealQty = typeof item.quantity === "number" && item.quantity > 0;
        const description = item.description || `${tradeLabel} scope item`;
        const rawQty = hasRealQty ? (item.quantity as number) : 1;
        const qty = roundQuantityForUnit(rawQty, item.unit);
        const itemForLookup = { ...item, quantity: qty };

        const notesBits: string[] = [];
        const internal = buildInternalNote(itemForLookup);
        if (internal) notesBits.push(internal);

        let finalUnit = item.unit || "ea";
        let finalQty = qty;
        let unit_cost = 0;
        let total_cost = 0;
        let total_price = 0;
        let pricedThisLine = false;
        let needsQuoteThisLine = Boolean(item.needsQuote) || !hasRealQty;

        if (tradeBudget > 0 && isFirstInTrade) {
          // Apply the full trade budget to the first line
          unit_cost = round2(tradeBudget * 0.77); // rough 30% markup backed out for cost
          total_cost = round2(tradeBudget * 0.77);
          total_price = round2(tradeBudget);
          finalQty = 1;
          finalUnit = "LS";
          notesBits.push(`Price source: Project budget ($${tradeBudget.toLocaleString()}) — covers all ${tradeLabel.toLowerCase()} scope items below`);
          pricedThisLine = true;
          needsQuoteThisLine = false;
          budgetApplied = true;
          budgetMatchedCount++;
        } else if (tradeBudget > 0 && !isFirstInTrade) {
          // Other lines in the same trade — rolled up into the first line
          unit_cost = 0;
          total_cost = 0;
          total_price = 0;
          needsQuoteThisLine = false;
          finalUnit = item.unit || "ea";
          notesBits.push(`Rolled into ${tradeLabel} trade budget on first line.`);
        } else {
          // No budget for this trade — fall back to trade_rates lookup
          const priced = lookupPrice(tradeKey, description, item.unit, qty, tradeRates);
          if (priced) {
            unit_cost = priced.unit_cost;
            total_cost = priced.total_cost;
            total_price = priced.total_price;
            finalQty = priced.final_quantity;
            finalUnit = priced.final_unit;
            notesBits.push(`Price source: ${priced.matched_rate} (Penney trade rates)`);
            pricedThisLine = true;
            needsQuoteThisLine = false;
            pricedCount++;
          } else {
            notesBits.push(`No project budget or trade rate match — sub to quote from plans.`);
          }
        }

        const proposal = buildProposalDescription(itemForLookup, tradeLabel);

        rows.push({
          estimate_id: estimateId,
          sort_order: sortIdx++,
          description,
          proposal_description: proposal,
          quantity: finalQty,
          unit: finalUnit,
          unit_cost,
          total_cost,
          markup_percentage: 0,
          total_price,
          is_visible_on_proposal: true,
          trade: tradeKey,
          needs_sub_quote: needsQuoteThisLine,
          source: "takeoff",
          notes: notesBits.join(" · "),
        });
        void pricedThisLine;
      }
      void budgetApplied;
    }

    if (rows.length > 0) {
      const { error: insertErr } = await supabase
        .from("estimate_line_items")
        .insert(rows);
      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
    }

    // ---- 3. Update projects.required_trades, but PRESERVE scope_of_work.
    // Jorge's scope_of_work often contains his own budget notes (source of
    // truth for pricing). We must NOT overwrite that text.
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

    return NextResponse.json({
      success: true,
      estimateId,
      lineItemCount: rows.length,
      pricedCount,
      budgetMatchedCount,
      tradeCount: tradeOrder.length,
      budgetMap: Object.fromEntries(budgetMap),
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

