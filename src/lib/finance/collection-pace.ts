import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { publishedCollectionPlan } from "@/lib/finance/published-collection-plan";

/**
 * How much money came in this week and this month, live from client payments
 * (payments_received), against the goal and weekly targets in the published
 * collection plan. Jorge 10/12: "every week we want to know how much money we
 * are collecting, and each month."
 *
 * The plan's own "reported collected" figures are an email snapshot; these
 * totals are recomputed from the payments on every visit (they matched the
 * 10/9 email to the penny: Oct 1–2 $32,115.06, Oct 5–9 $102,585.90).
 * Weeks run Monday–Sunday, Eastern time. All amounts are cents.
 */

export type PacePayment = {
  id: string;
  day: string;
  cents: number;
  project: string;
  type: string | null;
};

export type PaceWeek = {
  start: string;
  end: string;
  label: string;
  collected: number;
  target: number | null;
  current: boolean;
  future: boolean;
};

export type PaceMonth = { key: string; label: string; collected: number; count: number; goal: number | null; current: boolean };

export type CollectionPace = {
  today: string;
  thisWeek: { start: string; end: string; label: string; collected: number; target: number | null; payments: PacePayment[] };
  lastWeek: { label: string; collected: number };
  month: { key: string; label: string; collected: number; goal: number | null };
  weeks: PaceWeek[];
  months: PaceMonth[];
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const rangeLabel = (a: string, b: string) => {
  const x = parse(a), y = parse(b);
  return x.getMonth() === y.getMonth()
    ? `${MON[x.getMonth()]} ${x.getDate()}–${y.getDate()}`
    : `${MON[x.getMonth()]} ${x.getDate()} – ${MON[y.getMonth()]} ${y.getDate()}`;
};
const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100) || 0;

export async function getCollectionPace(db?: Awaited<ReturnType<typeof createClient>>): Promise<CollectionPace> {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = iso(today);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const monthKey = iso(monthStart).slice(0, 7);
  const historyStart = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  const from = iso(mondayOf(historyStart) < historyStart ? mondayOf(historyStart) : historyStart);

  const supabase = db ?? (await createClient());
  const rows = await fetchAllRows((f, t) =>
    supabase
      .from("payments_received")
      .select("id, amount, received_date, payment_type, projects(name, project_number)")
      .gte("received_date", from)
      .lte("received_date", todayStr)
      .order("received_date")
      .order("id")
      .range(f, t),
  );

  const payments: PacePayment[] = [];
  for (const r of rows) {
    if (!r.received_date) continue;
    const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    const name = (proj as { name?: string } | null)?.name ?? "No project";
    if (/^test\b/i.test(name)) continue; // demo invoices are not money in
    payments.push({ id: r.id, day: r.received_date.slice(0, 10), cents: cents(r.amount), project: name, type: r.payment_type ?? null });
  }
  const sum = (a: string, b: string) => payments.reduce((s, p) => (p.day >= a && p.day <= b ? s + p.cents : s), 0);

  const plan = publishedCollectionPlan.monthKey === monthKey ? publishedCollectionPlan : null;
  const targetFor = (start: string) => {
    const w = plan?.weeks.find((x) => x.start === start);
    return w && w.status === "Target" ? w.amount : null;
  };

  const weeks: PaceWeek[] = [];
  for (let d = mondayOf(monthStart); d <= monthEnd; d = addDays(d, 7)) {
    const start = iso(d < monthStart ? monthStart : d);
    const endD = addDays(d, 6);
    const end = iso(endD > monthEnd ? monthEnd : endD);
    weeks.push({
      start,
      end,
      label: rangeLabel(start, end),
      collected: sum(start, end),
      target: targetFor(start),
      current: start <= todayStr && todayStr <= end,
      future: start > todayStr,
    });
  }

  const wkStart = mondayOf(today);
  const wkEnd = addDays(wkStart, 6);
  const lastStart = addDays(wkStart, -7);
  const lastEnd = addDays(wkStart, -1);
  const current = weeks.find((w) => w.current);

  const months: PaceMonth[] = [];
  for (let i = 0; i < 6; i++) {
    const m = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = iso(m).slice(0, 7);
    const a = iso(m), b = iso(new Date(m.getFullYear(), m.getMonth() + 1, 0));
    months.push({
      key,
      label: `${FULL[m.getMonth()]} ${m.getFullYear()}`,
      collected: sum(a, b),
      count: payments.filter((p) => p.day >= a && p.day <= b).length,
      goal: publishedCollectionPlan.monthKey === key ? publishedCollectionPlan.goal : null,
      current: i === 0,
    });
  }

  return {
    today: todayStr,
    thisWeek: {
      start: iso(wkStart),
      end: iso(wkEnd),
      label: rangeLabel(iso(wkStart), iso(wkEnd)),
      collected: sum(iso(wkStart), iso(wkEnd)),
      target: current?.target ?? null,
      payments: payments.filter((p) => p.day >= iso(wkStart) && p.day <= iso(wkEnd)).reverse(),
    },
    lastWeek: { label: rangeLabel(iso(lastStart), iso(lastEnd)), collected: sum(iso(lastStart), iso(lastEnd)) },
    month: { key: monthKey, label: FULL[today.getMonth()], collected: sum(iso(monthStart), iso(monthEnd)), goal: plan?.goal ?? null },
    weeks,
    months,
  };
}
