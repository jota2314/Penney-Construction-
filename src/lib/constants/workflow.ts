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
    description: "New lead enters with project details",
    color: "bg-blue-500",
  },
  {
    key: "schedule_confirmation",
    label: "Schedule Confirmation",
    description: "Estimator confirms or reschedules walkthrough",
    color: "bg-indigo-500",
  },
  {
    key: "walkthrough",
    label: "Walkthrough",
    description: "On-site walkthrough with photos and recordings",
    color: "bg-purple-500",
  },
  {
    key: "estimating",
    label: "Estimating",
    description: "Estimator uploads estimate for owner review",
    color: "bg-amber-500",
  },
  {
    key: "owner_review",
    label: "Owner Review",
    description: "Owner reviews and approves the estimate",
    color: "bg-yellow-500",
  },
  {
    key: "client_review",
    label: "Client Review",
    description: "Estimate sent to client for approval",
    color: "bg-orange-500",
  },
  {
    key: "permit_deposit",
    label: "Permit & Deposit",
    description: "Collect 30% deposit and pull permits",
    color: "bg-emerald-500",
  },
  {
    key: "job_package",
    label: "Job Package",
    description: "Create job package in BuilderTrend",
    color: "bg-cyan-500",
  },
  {
    key: "pm_handoff",
    label: "PM Handoff",
    description: "Hand off project folder to PM",
    color: "bg-teal-500",
  },
  {
    key: "construction_started",
    label: "Construction",
    description: "PM starts the project",
    color: "bg-green-500",
  },
  {
    key: "rough_inspection",
    label: "Rough Inspection",
    description: "Rough inspection completed",
    color: "bg-lime-500",
  },
  {
    key: "final_inspection",
    label: "Final Inspection",
    description: "Final inspection completed",
    color: "bg-green-600",
  },
  {
    key: "audit",
    label: "Audit / Close-out",
    description: "Final audit and project close-out",
    color: "bg-green-700",
  },
];

export const STAGE_ORDER: WorkflowStage[] = [
  "lead_intake",
  "schedule_confirmation",
  "walkthrough",
  "estimating",
  "owner_review",
  "client_review",
  "permit_deposit",
  "job_package",
  "pm_handoff",
  "construction_started",
  "rough_inspection",
  "final_inspection",
  "audit",
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
