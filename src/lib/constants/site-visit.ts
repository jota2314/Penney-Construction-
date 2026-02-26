import type { SiteVisitStatus } from "@/types/database";

export const SITE_VISIT_STATUS_LABELS: Record<SiteVisitStatus, string> = {
  in_progress: "In Progress",
  completed: "Completed",
};

export const SITE_VISIT_STATUS_COLORS: Record<SiteVisitStatus, string> = {
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
};

export const ALL_SITE_VISIT_STATUSES: SiteVisitStatus[] = [
  "in_progress",
  "completed",
];
