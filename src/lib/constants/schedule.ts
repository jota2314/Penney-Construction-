import type { SchedulePhaseStatus } from "@/types/database";

export const PHASE_STATUS_LABELS: Record<SchedulePhaseStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  on_hold: "On Hold",
};

export const PHASE_STATUS_COLORS: Record<SchedulePhaseStatus, string> = {
  not_started: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  on_hold: "bg-amber-100 text-amber-700",
};

export const ALL_PHASE_STATUSES: SchedulePhaseStatus[] = [
  "not_started",
  "in_progress",
  "completed",
  "on_hold",
];

export const PHASE_COLOR_PALETTE = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
] as const;

export const DEFAULT_PHASE_NAMES = [
  "Permitting",
  "Site Prep",
  "Excavation",
  "Foundation",
  "Framing",
  "Roofing",
  "Windows & Doors",
  "Rough Plumbing",
  "Rough Electrical",
  "Rough HVAC",
  "Insulation",
  "Drywall",
  "Interior Trim",
  "Painting",
  "Tile",
  "Flooring",
  "Cabinets & Countertops",
  "Finish Plumbing",
  "Finish Electrical",
  "Final Inspections",
  "Punch List",
] as const;
