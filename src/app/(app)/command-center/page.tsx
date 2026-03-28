import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getHubMetrics } from "@/lib/actions/command-center-hub";
import { SyncButton } from "@/components/command-center/sync-button";
import { CommandCenterHub } from "@/components/command-center/command-center-hub";

export default async function CommandCenterPage() {
  await requireAuth();

  let metrics = await getHubMetrics().catch(() => ({
    projects: { active: 0, byStatus: {} },
    estimates: { total: 0, byStatus: {} },
    followUps: { open: 0, overdue: 0, byPriority: {} },
    quotes: { total: 0, byStatus: {} },
    schedule: { activeThisWeek: 0, inProgress: 0, upcoming: 0 },
    customers: { total: 0, newThisMonth: 0 },
    subcontractors: { active: 0, onProjects: 0 },
    email: { weekTotal: 0, sent: 0, received: 0, dailyVolume: [] },
    costBook: { rateCount: 0, lastUpdated: null },
  }));

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 4);

  const formatDate = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  const weekLabel = `Week of ${formatDate(weekStart)}\u2013${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;

  return (
    <>
      <Header title="Command Center" />
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <h2 className="text-2xl font-bold tracking-tight">
                Command Center
              </h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Penney Construction &middot; {weekLabel}
            </p>
          </div>
          <SyncButton />
        </div>

        {/* Tile Grid + AI Chat */}
        <CommandCenterHub metrics={metrics} />
      </div>
    </>
  );
}
