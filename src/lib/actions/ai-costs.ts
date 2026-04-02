"use server";

import { createClient } from "@/lib/supabase/server";

export interface AiCostSummary {
  todayCents: number;
  weekCents: number;
  monthCents: number;
  allTimeCents: number;
  todayCalls: number;
  monthCalls: number;
}

export async function getAiCostSummary(): Promise<AiCostSummary> {
  const supabase = await createClient();

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Fetch all usage for this month (covers today + week + month)
  const { data: monthEntries } = await supabase
    .from("ai_usage_logs")
    .select("cost_cents, created_at")
    .gte("created_at", monthStart.toISOString());

  // Fetch all-time total
  const { data: allTimeData } = await supabase
    .from("ai_usage_logs")
    .select("cost_cents");

  const entries = monthEntries ?? [];
  const allEntries = allTimeData ?? [];

  let todayCents = 0;
  let weekCents = 0;
  let monthCents = 0;
  let todayCalls = 0;

  for (const e of entries) {
    const cost = e.cost_cents || 0;
    const created = new Date(e.created_at);
    monthCents += cost;
    if (created >= weekStart) weekCents += cost;
    if (created >= todayStart) {
      todayCents += cost;
      todayCalls++;
    }
  }

  let allTimeCents = 0;
  for (const e of allEntries) {
    allTimeCents += e.cost_cents || 0;
  }

  return {
    todayCents,
    weekCents,
    monthCents,
    allTimeCents,
    todayCalls,
    monthCalls: entries.length,
  };
}
