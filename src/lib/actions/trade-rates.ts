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
  notes?: string | null;
  project_type?: ProjectType | null;
}

export async function getTradeRates() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trade_rates")
    .select("*")
    .eq("is_active", true)
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

/** Minimal shape for injecting into AI prompts.
 *  If projectType is provided, returns type-specific rates + general (null) rates.
 *  Otherwise returns all rates. */
export async function getTradeRatesForAI(projectType?: string | null) {
  const supabase = await createClient();

  if (projectType) {
    // Get project-type-specific rates + general (null project_type) rates
    const { data } = await supabase
      .from("trade_rates")
      .select("trade_name, unit_type, avg_cost, avg_price, project_type")
      .eq("is_active", true)
      .or(`project_type.eq.${projectType},project_type.is.null`)
      .order("trade_name");

    // If a trade has both a type-specific and general rate, prefer the type-specific one
    const rateMap = new Map<string, (typeof data extends (infer T)[] | null ? T : never)>();
    for (const r of data ?? []) {
      const key = `${r.trade_name}|${r.unit_type}`;
      const existing = rateMap.get(key);
      // Type-specific rate takes priority over general
      if (!existing || (r.project_type && !existing.project_type)) {
        rateMap.set(key, r);
      }
    }

    return Array.from(rateMap.values()).map(({ project_type: _, ...r }) => r);
  }

  const { data } = await supabase
    .from("trade_rates")
    .select("trade_name, unit_type, avg_cost, avg_price")
    .eq("is_active", true)
    .order("trade_name");
  return data ?? [];
}
