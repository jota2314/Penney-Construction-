import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getHubMetrics } from "@/lib/actions/command-center-hub";
import { CommandCenterHero } from "@/components/command-center/command-center-hero";
import { CommandCenterHub } from "@/components/command-center/command-center-hub";

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

  let metrics;
  try {
    metrics = await getHubMetrics();
  } catch {
    metrics = defaultMetrics;
  }

  // Use Eastern Time for date display (Penney Construction is in MA)
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dayName = nowET.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = nowET.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <>
      <Header title="Command Center" />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 min-w-0 overflow-auto">
        <CommandCenterHero
          dayName={dayName}
          dateStr={dateStr}
          projectCount={metrics.projects.active}
          todoCount={metrics.todos.open}
          emailCount={metrics.email.all.total}
        />
        <CommandCenterHub metrics={metrics} />
      </div>
    </>
  );
}
