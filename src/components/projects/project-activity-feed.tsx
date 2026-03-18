"use client";

import {
  Calculator,
  Camera,
  CalendarDays,
  FolderPlus,
  HardHat,
  FileText,
  Clock,
} from "lucide-react";

export interface ActivityItem {
  id: string;
  type:
    | "project_created"
    | "estimate"
    | "site_visit"
    | "schedule_phase"
    | "subcontractor"
    | "status_change";
  title: string;
  description?: string | null;
  timestamp: string;
  userName?: string | null;
}

const ICON_MAP: Record<ActivityItem["type"], React.ReactNode> = {
  project_created: <FolderPlus className="h-4 w-4" />,
  estimate: <Calculator className="h-4 w-4" />,
  site_visit: <Camera className="h-4 w-4" />,
  schedule_phase: <CalendarDays className="h-4 w-4" />,
  subcontractor: <HardHat className="h-4 w-4" />,
  status_change: <FileText className="h-4 w-4" />,
};

const COLOR_MAP: Record<ActivityItem["type"], string> = {
  project_created: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  estimate: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  site_visit: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  schedule_phase: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  subcontractor: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  status_change: "bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400",
};

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ProjectActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-6 text-center">
        <Clock className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30">
        <h3 className="text-sm font-semibold">Recent Activity</h3>
      </div>
      <div className="divide-y">
        {items.map((item) => (
          <div key={item.id} className="px-4 py-3 flex gap-3">
            <div
              className={`h-8 w-8 rounded-lg ${COLOR_MAP[item.type]} flex items-center justify-center shrink-0 mt-0.5`}
            >
              {ICON_MAP[item.type]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium leading-snug">{item.title}</p>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                  {timeAgo(item.timestamp)}
                </span>
              </div>
              {item.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {item.description}
                </p>
              )}
              {item.userName && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  by {item.userName}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
