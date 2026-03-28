import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  getCommandCenterStats,
  getActionInbox,
  getProjectStatusCards,
  getCrewDeployment,
} from "@/lib/actions/command-center";
import { SyncButton } from "@/components/command-center/sync-button";
import { CommandCenterShell } from "@/components/command-center/command-center-shell";

export default async function CommandCenterPage() {
  await requireAuth();

  let stats = { activeJobs: 0, followUps: 0, quotesOut: 0, updatesSent: 0, totalClients: 0 };
  let actionInbox: Awaited<ReturnType<typeof getActionInbox>> = { followUps: [], quotes: [], emails: [] };
  let projects: Awaited<ReturnType<typeof getProjectStatusCards>> = [];
  let crewDeployment: Awaited<ReturnType<typeof getCrewDeployment>> = [];

  try {
    [stats, actionInbox, projects, crewDeployment] = await Promise.all([
      getCommandCenterStats(),
      getActionInbox(),
      getProjectStatusCards(),
      getCrewDeployment(),
    ]);
  } catch {
    // Continue with defaults if queries fail
  }

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 4);

  const formatDate = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  const weekLabel = `Week of ${formatDate(weekStart)}\u2013${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;

  const totalActions =
    actionInbox.followUps.length +
    actionInbox.quotes.length +
    actionInbox.emails.length;

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

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{totalActions}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
              Actions Needed
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{stats.activeJobs}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
              Active Projects
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-purple-600">{stats.quotesOut}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
              Quotes Out
            </p>
          </div>
        </div>

        {/* Main Content: Morning View + AI Chat */}
        <CommandCenterShell
          actionInbox={actionInbox}
          projects={projects}
          crewDeployment={crewDeployment}
          stats={{
            activeJobs: stats.activeJobs,
            followUps: stats.followUps,
            quotesOut: stats.quotesOut,
          }}
        />
      </div>
    </>
  );
}
