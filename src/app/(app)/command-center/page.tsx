import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/require-auth";
import { getHubMetrics } from "@/lib/actions/command-center-hub";
import { CommandCenterHeader } from "@/components/command-center/command-center-hero";
import { CommandCenterHub } from "@/components/command-center/command-center-hub";
import { getWeather } from "@/lib/actions/weather";

export const metadata: Metadata = { title: "Command Center | Penney Construction" };

export default async function CommandCenterPage() {
  await requireAuth();

  const defaultMetrics = {
    projects: { active: 0, byStatus: {} },
    estimates: { total: 0, byStatus: {} },
    todos: { open: 0, overdue: 0, byPriority: {} },
    quotes: { total: 0, byStatus: {} },
    schedule: { activeThisWeek: 0, inProgress: 0, upcoming: 0 },
    customers: { total: 0, newThisMonth: 0 },
    subcontractors: { active: 0, onProjects: 0 },
    email: { all: { sent: 0, received: 0, total: 0 }, day: { sent: 0, received: 0, total: 0 }, week: { sent: 0, received: 0, total: 0 }, month: { sent: 0, received: 0, total: 0 }, dailyVolume: [] },
    costBook: { rateCount: 0, lastUpdated: null },
  };

  const [metrics, weather] = await Promise.all([
    getHubMetrics().catch(() => defaultMetrics),
    getWeather().catch(() => null),
  ]);

  // Eastern Time
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dateStr = nowET.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="flex flex-1 flex-col min-w-0 overflow-auto">
      <CommandCenterHeader dateStr={dateStr} weather={weather} />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <CommandCenterHub metrics={metrics} />
      </div>
    </div>
  );
}
