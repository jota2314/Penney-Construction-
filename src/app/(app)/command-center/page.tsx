import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/require-auth";
import { getHubMetrics } from "@/lib/actions/command-center-hub";
import { getCommandCenterV2Data, getQuarterLabel } from "@/lib/actions/command-center-v2";
import type { TimeRange } from "@/lib/time-range";
import { CommandCenterV2 } from "@/components/command-center/command-center-v2";
import { getWeather } from "@/lib/actions/weather";

export const metadata: Metadata = { title: "Command Center | Penney Construction" };

const VALID_RANGES: ReadonlyArray<TimeRange> = ["week", "month", "quarter", "year"];

export default async function CommandCenterPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string; offset?: string }>;
}) {
  await requireAuth();

  const params = (await searchParams) || {};
  const range: TimeRange = (VALID_RANGES as ReadonlyArray<string>).includes(params.range || "")
    ? (params.range as TimeRange)
    : "week";
  const offset = Number.parseInt(params.offset || "0", 10) || 0;

  const defaultMetrics = {
    projects: { active: 0, byStatus: {} },
    estimates: { total: 0, byStatus: {} },
    todos: { open: 0, overdue: 0, byPriority: {} },
    quotes: { total: 0, byStatus: {} },
    schedule: { activeThisWeek: 0, inProgress: 0, upcoming: 0 },
    customers: { total: 0, newThisMonth: 0 },
    subcontractors: { active: 0, onProjects: 0 },
    email: {
      all: { sent: 0, received: 0, total: 0 },
      day: { sent: 0, received: 0, total: 0 },
      week: { sent: 0, received: 0, total: 0 },
      month: { sent: 0, received: 0, total: 0 },
      dailyVolume: [],
    },
    costBook: { rateCount: 0, lastUpdated: null },
  };

  const defaultV2 = {
    period: { range, offset, start: new Date().toISOString(), end: new Date().toISOString(), label: "This week", isCurrent: true },
    money: { contract: 0, spent: 0, received: 0, committed: 0, remaining: 0, pipeline: 0, marginQ2: 0, marginTrend: 0, revenueQ2ToDate: 0, revenueQ2Target: 1_000_000 },
    projects: [],
    week: [],
    todayIdx: 0,
    attention: [],
    pipeline: {
      estimates: { draft: 0, review: 0, approved: 0, sent: 0, totalValue: 0 },
      quotes: { awaiting: 0, received: 0, accepted: 0, declined: 0 },
      leadsThisWeek: 0,
      actualOverheadYtd: 0,
      overheadPeriodLabel: "no data yet",
    },
    stakeholders: [],
    recent: [],
    headline: { active: 0, inFlight: 0, paceDeltaPct: 0, healthStatus: "Quiet" },
  };

  const [metrics, v2Data, weather, quarterLabel] = await Promise.all([
    getHubMetrics().catch(() => defaultMetrics),
    getCommandCenterV2Data({ range, offset }).catch(() => defaultV2),
    getWeather().catch(() => null),
    getQuarterLabel(),
  ]);

  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dateStr = nowET.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <CommandCenterV2
      data={v2Data}
      hub={metrics}
      weather={weather}
      dateStr={dateStr}
      quarterLabel={quarterLabel}
    />
  );
}
