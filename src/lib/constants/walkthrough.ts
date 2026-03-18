import type { WalkthroughStatus } from "@/types/database";

export const WALKTHROUGH_STATUS_LABELS: Record<WalkthroughStatus, string> = {
  in_progress: "In Progress",
  completed: "Completed",
};

export const WALKTHROUGH_STATUS_COLORS: Record<WalkthroughStatus, string> = {
  in_progress: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
};

export const ALL_WALKTHROUGH_STATUSES: WalkthroughStatus[] = [
  "in_progress",
  "completed",
];
