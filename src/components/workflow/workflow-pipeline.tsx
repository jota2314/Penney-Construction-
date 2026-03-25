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
      <div className="flex items-center gap-1">
        {WORKFLOW_STAGES.map((stage, i) => (
          <div
            key={stage.key}
            className={`h-2 flex-1 rounded-full ${
              i <= currentIndex ? stage.color : "bg-muted"
            }`}
            title={stage.label}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {WORKFLOW_STAGES.map((stage, i) => {
        const isComplete = i < currentIndex;
        const isCurrent = i === currentIndex;

        return (
          <div key={stage.key} className="flex items-center gap-2">
            <div className="flex flex-col items-center min-w-[80px]">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
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
                className={`text-xs mt-1 text-center ${
                  isCurrent
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {stage.label}
              </span>
            </div>
            {i < WORKFLOW_STAGES.length - 1 && (
              <div
                className={`h-0.5 w-6 ${
                  i < currentIndex ? stage.color : "bg-muted"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
