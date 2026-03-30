"use client";

import {
  FolderKanban,
  Calculator,
  Bell,
  FileCheck,
  CalendarDays,
  Users,
  HardHat,
  Mail,
  BookOpen,
} from "lucide-react";
import { NavigationTile } from "./navigation-tile";
import { MiniBarSegments, MiniDonut, MiniSparkline, PriorityBadges } from "./mini-charts";
import { Badge } from "@/components/ui/badge";
import type { HubMetrics } from "@/lib/actions/command-center-hub";

interface NavigationTileGridProps {
  metrics: HubMetrics;
}

export function NavigationTileGrid({ metrics }: NavigationTileGridProps) {
  const { projects, estimates, todos, quotes, schedule, customers, subcontractors, email, costBook } = metrics;

  // Format "last updated" for cost book
  const costBookSubtitle = costBook.lastUpdated
    ? `Updated ${formatRelativeDate(costBook.lastUpdated)}`
    : "No rates yet";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {/* Row 1: Projects, Estimates, Todos */}
      <NavigationTile
        title="Projects"
        icon={FolderKanban}
        iconColorClass="bg-blue-500/15 text-blue-500"
        metric={projects.active}
        metricLabel="Active Projects"
        metricColorClass="text-blue-600 dark:text-blue-400"
        href="/projects"
      >
        <MiniBarSegments
          segments={[
            { label: "Lead", value: projects.byStatus["lead"] || 0, color: "bg-slate-400" },
            { label: "Estimating", value: projects.byStatus["estimating"] || 0, color: "bg-amber-500" },
            { label: "Proposal", value: projects.byStatus["proposal_sent"] || 0, color: "bg-purple-500" },
            { label: "Contracted", value: projects.byStatus["contracted"] || 0, color: "bg-blue-500" },
            { label: "Active", value: projects.byStatus["in_progress"] || 0, color: "bg-emerald-500" },
          ]}
        />
      </NavigationTile>

      <NavigationTile
        title="Estimates"
        icon={Calculator}
        iconColorClass="bg-amber-500/15 text-amber-600"
        metric={estimates.total}
        metricLabel="Total"
        metricColorClass="text-amber-600 dark:text-amber-400"
        href="/estimates"
      >
        <MiniDonut
          data={[
            { name: "Draft", value: estimates.byStatus["draft"] || 0, color: "#6b7280" },
            { name: "Review", value: estimates.byStatus["review"] || 0, color: "#f59e0b" },
            { name: "Approved", value: estimates.byStatus["approved"] || 0, color: "#10b981" },
            { name: "Sent", value: estimates.byStatus["sent"] || 0, color: "#3b82f6" },
          ]}
        />
      </NavigationTile>

      <NavigationTile
        title="Todos"
        icon={Bell}
        iconColorClass={
          todos.overdue > 0
            ? "bg-red-500/15 text-red-500"
            : "bg-purple-500/15 text-purple-500"
        }
        metric={todos.open}
        metricLabel="Open"
        metricColorClass={todos.overdue > 0 ? "text-red-500" : "text-purple-600 dark:text-purple-400"}
        href="/command-center/todos"
        urgencyBadge={
          todos.overdue > 0
            ? { label: `${todos.overdue} overdue`, variant: "destructive", pulse: true }
            : undefined
        }
      >
        <PriorityBadges byPriority={todos.byPriority} />
      </NavigationTile>

      {/* Row 2: Quotes, Schedule, Clients */}
      <NavigationTile
        title="Quotes"
        icon={FileCheck}
        iconColorClass="bg-emerald-500/15 text-emerald-500"
        metric={quotes.total}
        metricLabel="Total Quotes"
        metricColorClass="text-emerald-600 dark:text-emerald-400"
        href="/command-center/quotes"
        urgencyBadge={
          (quotes.byStatus["awaiting_reply"] || 0) > 5
            ? { label: `${quotes.byStatus["awaiting_reply"]} awaiting`, variant: "default" }
            : undefined
        }
      >
        <MiniBarSegments
          segments={[
            { label: "Sent", value: quotes.byStatus["just_sent"] || 0, color: "bg-blue-500" },
            { label: "Awaiting", value: quotes.byStatus["awaiting_reply"] || 0, color: "bg-orange-500" },
            { label: "Received", value: quotes.byStatus["received"] || 0, color: "bg-green-500" },
            { label: "Accepted", value: quotes.byStatus["accepted"] || 0, color: "bg-emerald-500" },
            { label: "Declined", value: quotes.byStatus["declined"] || 0, color: "bg-red-500" },
          ]}
        />
      </NavigationTile>

      <NavigationTile
        title="Schedule"
        icon={CalendarDays}
        iconColorClass="bg-indigo-500/15 text-indigo-500"
        metric={schedule.activeThisWeek}
        metricLabel="This Week"
        metricColorClass="text-indigo-600 dark:text-indigo-400"
        href="/schedule"
      >
        <div className="flex gap-2 flex-wrap">
          {schedule.inProgress > 0 && (
            <Badge variant="outline" className="text-[10px] bg-emerald-500/20 text-emerald-500 border-emerald-500/30">
              {schedule.inProgress} in progress
            </Badge>
          )}
          {schedule.upcoming > 0 && (
            <Badge variant="outline" className="text-[10px] bg-blue-500/20 text-blue-500 border-blue-500/30">
              {schedule.upcoming} upcoming
            </Badge>
          )}
        </div>
      </NavigationTile>

      <NavigationTile
        title="Clients"
        icon={Users}
        iconColorClass="bg-violet-500/15 text-violet-500"
        metric={customers.total}
        metricLabel="Total Clients"
        metricColorClass="text-violet-600 dark:text-violet-400"
        href="/customers"
      >
        {customers.newThisMonth > 0 && (
          <span className="text-xs text-muted-foreground">
            {customers.newThisMonth} new this month
          </span>
        )}
      </NavigationTile>

      {/* Row 3: Subcontractors, Email, Cost Book */}
      <NavigationTile
        title="Subcontractors"
        icon={HardHat}
        iconColorClass="bg-orange-500/15 text-orange-600"
        metric={subcontractors.active}
        metricLabel="Active Subs"
        metricColorClass="text-orange-600 dark:text-orange-400"
        href="/subcontractors"
      >
        {subcontractors.onProjects > 0 && (
          <span className="text-xs text-muted-foreground">
            {subcontractors.onProjects} on projects
          </span>
        )}
      </NavigationTile>

      <NavigationTile
        title="Email"
        icon={Mail}
        iconColorClass="bg-sky-500/15 text-sky-500"
        metric={email.weekTotal}
        metricLabel="This Week"
        metricColorClass="text-sky-600 dark:text-sky-400"
        href="/command-center/emails"
      >
        <MiniSparkline data={email.dailyVolume} />
      </NavigationTile>

      <NavigationTile
        title="Cost Book"
        icon={BookOpen}
        iconColorClass="bg-teal-500/15 text-teal-600"
        metric={costBook.rateCount}
        metricLabel="Trade Rates"
        metricColorClass="text-teal-600 dark:text-teal-400"
        href="/cost-book"
      >
        <span className="text-xs text-muted-foreground">{costBookSubtitle}</span>
      </NavigationTile>
    </div>
  );
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}
