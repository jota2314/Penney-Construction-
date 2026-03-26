"use client";

import { WORKFLOW_STAGES, getStageIndex } from "@/lib/constants/workflow";
import type { WorkflowStage } from "@/types/database";
import { Check } from "lucide-react";

interface WorkflowPipelineProps {
  currentStage: WorkflowStage;
  compact?: boolean;
}

export function WorkflowPipeline({
  currentStage,
  compact = false,
}: WorkflowPipelineProps) {
  const currentIndex = getStageIndex(currentStage);

  if (compact) {
    return (
      <div className="flex items-center gap-0.5">
        {WORKFLOW_STAGES.map((stage, i) => (
          <div
            key={stage.key}
            className={`h-1.5 flex-1 rounded-full ${
              i <= currentIndex ? stage.color : "bg-muted"
            }`}
            title={stage.label}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 sm:grid-cols-7 gap-3 pb-2">
      {WORKFLOW_STAGES.map((stage, i) => {
        const isComplete = i < currentIndex;
        const isCurrent = i === currentIndex;

        return (
          <div key={stage.key} className="flex flex-col items-center gap-1">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shrink-0 ${
                isComplete
                  ? `${stage.color} text-white`
                  : isCurrent
                  ? `${stage.color} text-white ring-2 ring-offset-2 ring-current`
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {isComplete ? (
                <Check className="h-4 w-4" />
              ) : (
                i + 1
              )}
            </div>
            <span
              className={`text-[10px] leading-tight text-center ${
                isCurrent
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {stage.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
