import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  getCommandCenterStats,
  getActiveProjects,
  getQuoteRequests,
  getQuoteStatusCounts,
  getFollowUps,
  getClientUpdates,
  getEmailVolume,
  getPerformanceHighlights,
} from "@/lib/actions/command-center";
import { StatsBar } from "@/components/command-center/stats-bar";
import { CommandCenterTabs } from "@/components/command-center/command-center-tabs";
import { EmailVolumeChart } from "@/components/command-center/email-volume-chart";
import { QuoteStatusCards } from "@/components/command-center/quote-status-cards";
import { PerformanceHighlights } from "@/components/command-center/performance-highlights";

export default async function CommandCenterPage() {
  await requireAuth();

  const [stats, projects, quotes, quoteCounts, followUps, clientUpdates, emailVolume, performance] =
    await Promise.all([
      getCommandCenterStats(),
      getActiveProjects(),
      getQuoteRequests(),
      getQuoteStatusCounts(),
      getFollowUps(),
      getClientUpdates(),
      getEmailVolume(),
      getPerformanceHighlights(),
    ]);

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
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-2xl font-bold tracking-tight">
              Precon Command Center
            </h2>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Penney Construction &middot; {weekLabel}
          </p>
        </div>

        {/* Stats Bar */}
        <StatsBar
          activeJobs={stats.activeJobs}
          followUps={stats.followUps}
          quotesOut={stats.quotesOut}
          updatesSent={stats.updatesSent}
          totalClients={stats.totalClients}
        />

        {/* Tabs: Projects, Follow-ups, Quotes, Clients */}
        <CommandCenterTabs
          data={{
            projects: projects.map((p) => ({
              id: p.id,
              name: p.name,
              address: p.address,
              city: p.city,
              phase: p.phase || null,
              status: p.status,
              quote_count: p.quote_count,
              next_action: p.next_action,
              progress: p.progress,
              subcontractor_names: p.subcontractor_names,
            })),
            quotes,
            quoteCounts,
            followUps,
            clientUpdates,
          }}
        />

        {/* Analytics Section */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border bg-card p-4">
            <EmailVolumeChart data={emailVolume} />
          </div>
          <div className="rounded-lg border bg-card p-4">
            <QuoteStatusCards counts={quoteCounts} />
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <PerformanceHighlights data={performance} />
        </div>
      </div>
    </>
  );
}
