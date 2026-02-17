import type { ProjectStatus, ProjectType } from "@/types/database";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  lead: "Lead",
  estimating: "Estimating",
  proposal_sent: "Proposal Sent",
  contracted: "Contracted",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  lead: "bg-slate-100 text-slate-700",
  estimating: "bg-blue-100 text-blue-700",
  proposal_sent: "bg-amber-100 text-amber-700",
  contracted: "bg-purple-100 text-purple-700",
  in_progress: "bg-emerald-100 text-emerald-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  remodel: "Remodel",
  addition: "Addition",
  kitchen: "Kitchen",
  bathroom: "Bathroom",
  new_construction: "New Construction",
  other: "Other",
};

export const ALL_STATUSES: ProjectStatus[] = [
  "lead",
  "estimating",
  "proposal_sent",
  "contracted",
  "in_progress",
  "completed",
  "cancelled",
];

export const ALL_PROJECT_TYPES: ProjectType[] = [
  "remodel",
  "addition",
  "kitchen",
  "bathroom",
  "new_construction",
  "other",
];
