"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WorkflowPipeline } from "./workflow-pipeline";
import { getStageInfo } from "@/lib/constants/workflow";
import type { WorkflowInstance } from "@/types/database";
import {
  User,
  MapPin,
  Calendar,
  DollarSign,
} from "lucide-react";

interface WorkflowCardProps {
  workflow: WorkflowInstance;
}

export function WorkflowCard({ workflow }: WorkflowCardProps) {
  const stageInfo = getStageInfo(workflow.current_stage);

  const statusColors: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    paused: "bg-yellow-100 text-yellow-800",
    completed: "bg-blue-100 text-blue-800",
    cancelled: "bg-red-100 text-red-800",
  };

  return (
    <Link href={`/workflow/${workflow.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base truncate">
                {workflow.project_name}
              </CardTitle>
              <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                <User className="h-3 w-3 shrink-0" />
                <span className="truncate">{workflow.client_name}</span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Badge variant="secondary" className={statusColors[workflow.status]}>
                {workflow.status}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <WorkflowPipeline currentStage={workflow.current_stage} compact />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {stageInfo?.label}
            </span>
            <span>{stageInfo?.description}</span>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {workflow.project_address && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {workflow.project_city || workflow.project_address}
              </span>
            )}
            {workflow.walkthrough_date && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(workflow.walkthrough_date).toLocaleDateString()}
              </span>
            )}
            {workflow.estimate_amount && (
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />$
                {Number(workflow.estimate_amount).toLocaleString()}
              </span>
            )}
            <span>
              {new Date(workflow.created_at).toLocaleDateString()}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
