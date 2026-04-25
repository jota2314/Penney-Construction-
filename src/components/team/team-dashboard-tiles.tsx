"use client";

import { NavigationTile } from "@/components/command-center/navigation-tile";
import {
  FolderKanban,
  Calculator,
  Bell,
  FileText,
  Clock,
  CalendarCheck,
  DollarSign,
} from "lucide-react";

interface OfficeStats {
  activeProjects: number;
  pendingEstimates: number;
  openFollowUps: number;
  recentQuotes: number;
}

interface FieldStats {
  hoursThisWeek: number;
  activeProjects: number;
  timeEntriesLast14d: number;
  hourlyRate: number | null;
  earningsThisWeek: number;
}

export function OfficeWorkloadTiles({
  stats,
  profileId,
}: {
  stats: OfficeStats;
  profileId: string | null;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <NavigationTile
        title="Active Projects"
        icon={FolderKanban}
        iconColorClass="bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
        metric={stats.activeProjects ?? 0}
        metricLabel="projects"
        href={profileId ? `/projects?assigned=${profileId}` : undefined}
      />
      <NavigationTile
        title="Pending Estimates"
        icon={Calculator}
        iconColorClass="bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400"
        metric={stats.pendingEstimates ?? 0}
        metricLabel="drafts"
        href={profileId ? `/estimates?createdBy=${profileId}` : undefined}
      />
      <NavigationTile
        title="Open Follow-ups"
        icon={Bell}
        iconColorClass="bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400"
        metric={stats.openFollowUps ?? 0}
        metricLabel="todos"
        href={profileId ? `/command-center/todos?assigned=${profileId}` : undefined}
      />
      <NavigationTile
        title="Recent Quotes"
        icon={FileText}
        iconColorClass="bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400"
        metric={stats.recentQuotes ?? 0}
        metricLabel="last 30d"
      />
    </div>
  );
}

export function FieldWorkTiles({ stats }: { stats: FieldStats }) {
  const fieldHourlyRate =
    typeof stats.hourlyRate === "number" && Number.isFinite(stats.hourlyRate)
      ? stats.hourlyRate
      : null;
  const fieldEarnings =
    typeof stats.earningsThisWeek === "number" && Number.isFinite(stats.earningsThisWeek)
      ? stats.earningsThisWeek
      : null;
  const hoursThisWeek =
    typeof stats.hoursThisWeek === "number" && Number.isFinite(stats.hoursThisWeek)
      ? stats.hoursThisWeek
      : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <NavigationTile
        title="Hours This Week"
        icon={Clock}
        iconColorClass="bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
        metric={hoursThisWeek}
        metricLabel="hours"
      />
      <NavigationTile
        title="Active Projects"
        icon={FolderKanban}
        iconColorClass="bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400"
        metric={stats.activeProjects ?? 0}
        metricLabel="assigned"
      />
      <NavigationTile
        title="Time Entries"
        icon={CalendarCheck}
        iconColorClass="bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400"
        metric={stats.timeEntriesLast14d ?? 0}
        metricLabel="last 14d"
      />
      <NavigationTile
        title="Earnings This Week"
        icon={DollarSign}
        iconColorClass="bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
        metric={
          fieldHourlyRate !== null && fieldEarnings !== null
            ? `$${fieldEarnings.toFixed(0)}`
            : "—"
        }
        metricLabel={fieldHourlyRate !== null ? `at $${fieldHourlyRate}/hr` : "no rate set"}
      />
    </div>
  );
}
