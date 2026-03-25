import type { WorkflowStage } from "@/types/database";

export const WORKFLOW_STAGES: {
  key: WorkflowStage;
  label: string;
  description: string;
  color: string;
}[] = [
  {
    key: "lead_intake",
    label: "Lead Intake",
    description: "New lead enters the system with project details",
    color: "bg-blue-500",
  },
  {
    key: "walkthrough",
    label: "Walkthrough",
    description: "Schedule and complete property walkthrough",
    color: "bg-purple-500",
  },
  {
    key: "estimating",
    label: "Estimating",
    description: "Estimator prepares detailed estimate",
    color: "bg-amber-500",
  },
  {
    key: "client_review",
    label: "Client Review",
    description: "Estimate sent to client for approval",
    color: "bg-orange-500",
  },
  {
    key: "admin_deposit",
    label: "Admin & Deposit",
    description: "Contract sent and deposit collected",
    color: "bg-emerald-500",
  },
  {
    key: "job_package",
    label: "Job Package",
    description: "Estimator creates job package for PM",
    color: "bg-cyan-500",
  },
  {
    key: "project_management",
    label: "Project Management",
    description: "Handed off to project manager",
    color: "bg-green-500",
  },
];

export const STAGE_ORDER: WorkflowStage[] = [
  "lead_intake",
  "walkthrough",
  "estimating",
  "client_review",
  "admin_deposit",
  "job_package",
  "project_management",
];

export function getNextStage(
  current: WorkflowStage
): WorkflowStage | null {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx === -1 || idx >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

export function getStageIndex(stage: WorkflowStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function getStageInfo(stage: WorkflowStage) {
  return WORKFLOW_STAGES.find((s) => s.key === stage);
}
