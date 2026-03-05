import type { SiteVisitStatus, SiteVisitType } from "@/types/database";

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

export const SITE_VISIT_TYPE_LABELS: Record<SiteVisitType, string> = {
  pricing: "Pricing",
  progress: "Progress",
  punch_list: "Punch List",
};

export const SITE_VISIT_TYPE_COLORS: Record<SiteVisitType, string> = {
  pricing: "bg-amber-100 text-amber-700",
  progress: "bg-blue-100 text-blue-700",
  punch_list: "bg-purple-100 text-purple-700",
};

export const ALL_SITE_VISIT_TYPES: SiteVisitType[] = [
  "pricing",
  "progress",
  "punch_list",
];
