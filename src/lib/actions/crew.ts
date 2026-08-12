"use server";

import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { isHiddenPayEmail } from "@/lib/auth/role-access";

export async function getCrewEmployee() {
  const supabase = await createClient();
  const user = await getUser();
  const profileId = user?.profile?.id;
  if (!profileId) return null;

  const { data: employee } = await supabase
    .from("employees")
    .select("*")
    .eq("profile_id", profileId)
    .single();

  // Hidden-pay people (HIDDEN_PAY_EMAILS) never see a rate — not even on
  // their own profile page.
  if (
    employee &&
    (isHiddenPayEmail(employee.email) || isHiddenPayEmail(user?.profile?.email))
  ) {
    return { ...employee, hourly_rate: null };
  }

  return employee;
}

/**
 * Earnings for the current field worker, computed from the daily-logs clock
 * (the single source of clocked field time). Hours × hourly rate, rolled up for
 * today, this week, and the current biweekly pay period.
 */
export async function getCrewEarnings() {
  const supabase = await createClient();
  const user = await getUser();
  const profileId = user?.profile?.id ?? user?.id;
  if (!profileId) return null;

  const { data: employee } = await supabase
    .from("employees")
    .select("id, hourly_rate, email")
    .eq("profile_id", profileId)
    .single();

  if (!employee || !employee.hourly_rate) return null;

  // Hidden-pay people (HIDDEN_PAY_EMAILS) get no earnings card, even for
  // their own time — their pay renders nowhere in the app.
  if (
    isHiddenPayEmail(employee.email) ||
    isHiddenPayEmail(user?.profile?.email)
  ) {
    return null;
  }

  const rate = employee.hourly_rate;

  // Today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // This week (Sunday start)
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  // Pay period — biweekly, using a known epoch (Jan 1 2024 was a Monday)
  const periodEpoch = new Date("2024-01-01T00:00:00");
  const daysSinceEpoch = Math.floor((Date.now() - periodEpoch.getTime()) / 86400000);
  const daysIntoPeriod = daysSinceEpoch % 14;
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - daysIntoPeriod);
  periodStart.setHours(0, 0, 0, 0);
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodEnd.getDate() + 13);

  // Completed shifts from period start (covers today + week + period).
  const { data: logs } = await supabase
    .from("daily_logs")
    .select("started_at, ended_at")
    .eq("author_id", profileId)
    .eq("status", "completed")
    .not("ended_at", "is", null)
    .gte("started_at", periodStart.toISOString());

  const centsFor = (since: Date): number => {
    let cents = 0;
    for (const l of logs ?? []) {
      if (!l.ended_at) continue;
      const start = new Date(l.started_at);
      if (start < since) continue;
      const hours = (new Date(l.ended_at).getTime() - start.getTime()) / 3600000;
      if (hours > 0) cents += Math.round(hours * rate * 100);
    }
    return cents;
  };

  // Active clock
  const { data: activeEntry } = await supabase
    .from("daily_logs")
    .select("started_at")
    .eq("author_id", profileId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const periodLabel = `Pay Period (${fmt(periodStart)} – ${fmt(periodEnd)})`;

  return {
    hourlyRate: rate,
    clockInTime: activeEntry?.started_at ?? null,
    todayEarnedCents: centsFor(todayStart),
    weekEarnedCents: centsFor(weekStart),
    periodEarnedCents: centsFor(periodStart),
    periodLabel,
  };
}
