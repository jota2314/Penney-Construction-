"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { UnitType, ProjectType } from "@/types/database";

interface TradeRateInput {
  trade_name: string;
  description?: string | null;
  unit_type: UnitType;
  avg_cost: number;
  avg_price: number;
  min_cost?: number | null;
  max_cost?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  trade_category?: string | null;
  subcategory?: string | null;
  scope_includes?: string | null;
  notes?: string | null;
  project_type?: ProjectType | null;
}

export async function getTradeRates() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trade_rates")
    .select("*")
    .eq("is_active", true)
    .order("trade_category")
    .order("subcategory")
    .order("trade_name");
  if (error) return [];
  return data;
}

export async function createTradeRate(input: TradeRateInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("trade_rates").insert({
    trade_name: input.trade_name.trim(),
    description: input.description?.trim() || null,
    unit_type: input.unit_type,
    avg_cost: input.avg_cost,
    avg_price: input.avg_price,
    min_cost: input.min_cost ?? null,
    max_cost: input.max_cost ?? null,
    min_price: input.min_price ?? null,
    max_price: input.max_price ?? null,
    trade_category: input.trade_category?.trim() || null,
    subcategory: input.subcategory?.trim() || null,
    scope_includes: input.scope_includes?.trim() || null,
    notes: input.notes?.trim() || null,
    project_type: input.project_type || null,
    data_sources: ["manual"],
    last_updated_from: "manual",
    created_by: user.id,
  });

  if (error) return { error: error.message };
  revalidatePath("/cost-book");
  return { error: null };
}

export async function updateTradeRate(id: string, input: Partial<TradeRateInput>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const update: Record<string, unknown> = {};
  if (input.trade_name !== undefined) update.trade_name = input.trade_name.trim();
  if (input.description !== undefined) update.description = input.description?.trim() || null;
  if (input.unit_type !== undefined) update.unit_type = input.unit_type;
  if (input.avg_cost !== undefined) update.avg_cost = input.avg_cost;
  if (input.avg_price !== undefined) update.avg_price = input.avg_price;
  if (input.min_cost !== undefined) update.min_cost = input.min_cost;
  if (input.max_cost !== undefined) update.max_cost = input.max_cost;
  if (input.min_price !== undefined) update.min_price = input.min_price;
  if (input.max_price !== undefined) update.max_price = input.max_price;
  if (input.trade_category !== undefined) update.trade_category = input.trade_category?.trim() || null;
  if (input.subcategory !== undefined) update.subcategory = input.subcategory?.trim() || null;
  if (input.scope_includes !== undefined) update.scope_includes = input.scope_includes?.trim() || null;
  if (input.notes !== undefined) update.notes = input.notes?.trim() || null;
  if (input.project_type !== undefined) update.project_type = input.project_type || null;
  update.last_updated_from = "manual";

  const { error } = await supabase
    .from("trade_rates")
    .update(update)
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/cost-book");
  return { error: null };
}

export async function deleteTradeRate(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("trade_rates").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/cost-book");
  return { error: null };
}

/** Structured cost book for AI prompts with LOW/MID/HIGH ranges grouped by trade.
 *  If projectType is provided, returns type-specific rates + general (null) rates. */
export async function getTradeRatesForAI(projectType?: string | null) {
  const supabase = await createClient();

  const query = supabase
    .from("trade_rates")
    .select("trade_name, trade_category, subcategory, unit_type, avg_cost, avg_price, min_price, max_price, scope_includes, project_type")
    .eq("is_active", true)
    .order("trade_category")
    .order("trade_name");

  if (projectType) {
    query.or(`project_type.eq.${projectType},project_type.is.null`);
  }

  const { data } = await query;
  const rates = data ?? [];

  // Deduplicate: type-specific rate takes priority over general
  if (projectType) {
    const rateMap = new Map<string, (typeof rates)[number]>();
    for (const r of rates) {
      const key = `${r.trade_name}|${r.unit_type}|${r.subcategory}`;
      const existing = rateMap.get(key);
      if (!existing || (r.project_type && !existing.project_type)) {
        rateMap.set(key, r);
      }
    }
    return Array.from(rateMap.values());
  }

  return rates;
}

/** Format cost book as structured text for AI system prompts */
export function formatCostBookForAI(rates: Awaited<ReturnType<typeof getTradeRatesForAI>>): string {
  const grouped = new Map<string, typeof rates>();
  for (const r of rates) {
    const cat = r.trade_category || "General";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(r);
  }

  const lines: string[] = ["## COST BOOK — Penney Construction (North Shore MA)", "All prices are CLIENT SELL prices. Our cost = price ÷ 1.30 (30% markup).", ""];

  for (const [category, items] of grouped) {
    lines.push(`### ${category}`);
    let lastSubcat = "";
    for (const r of items) {
      if (r.subcategory && r.subcategory !== lastSubcat) {
        lines.push(`**${r.subcategory}:**`);
        lastSubcat = r.subcategory;
      }
      const low = r.min_price ? `$${Number(r.min_price).toLocaleString()}` : "";
      const mid = `$${Number(r.avg_price).toLocaleString()}`;
      const high = r.max_price ? `$${Number(r.max_price).toLocaleString()}` : "";
      const unit = r.unit_type === "each" ? "/ea" : r.unit_type === "sqft" ? "/sf" : r.unit_type === "linear_ft" ? "/lf" : "/ls";
      const range = low && high ? `${low}–${mid}–${high}` : mid;
      const scope = r.scope_includes ? ` — ${r.scope_includes.substring(0, 80)}` : "";
      lines.push(`- ${r.trade_name}: ${range}${unit}${scope}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
