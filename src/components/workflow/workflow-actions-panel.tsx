"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  advanceWorkflowStage,
  recordClientApproval,
  recordDeposit,
  markJobPackageCreated,
  scheduleWalkthrough,
  cancelWorkflow,
} from "@/lib/actions/workflow";
import { getStageInfo, getNextStage } from "@/lib/constants/workflow";
import type { WorkflowInstance, Profile } from "@/types/database";
import {
  ArrowRight,
  Loader2,
  Calendar,
  CheckCircle2,
  DollarSign,
  Package,
  XCircle,
} from "lucide-react";

interface WorkflowActionsPanelProps {
  workflow: WorkflowInstance;
  profiles?: Profile[];
}

export function WorkflowActionsPanel({
  workflow,
  profiles = [],
}: WorkflowActionsPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [walkthroughDate, setWalkthroughDate] = useState("");
  const [selectedPm, setSelectedPm] = useState("");
  const router = useRouter();

  const currentStage = workflow.current_stage;
  const nextStage = getNextStage(currentStage);
  const nextStageInfo = nextStage ? getStageInfo(nextStage) : null;

  const projectManagers = profiles.filter(
    (p) => p.role === "project_manager" || p.role === "owner"
  );

  if (workflow.status !== "active") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workflow {workflow.status}</CardTitle>
          <CardDescription>
            This workflow is no longer active.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  function handleAction(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Next Action</CardTitle>
        <CardDescription>
          {nextStageInfo
            ? `Advance to: ${nextStageInfo.label}`
            : "Workflow complete"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">
            {error}
          </div>
        )}

        {/* Stage-specific actions */}
        {currentStage === "lead_intake" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Schedule a walkthrough and advance to the next stage.
            </p>
            {!workflow.walkthrough_date && (
              <div>
                <Label htmlFor="walkthrough_date">Walkthrough Date & Time</Label>
                <Input
                  id="walkthrough_date"
                  type="datetime-local"
                  value={walkthroughDate}
                  onChange={(e) => setWalkthroughDate(e.target.value)}
                />
                <Button
                  className="mt-2 w-full"
                  variant="outline"
                  disabled={isPending || !walkthroughDate}
                  onClick={() =>
                    handleAction(() =>
                      scheduleWalkthrough(
                        workflow.id,
                        new Date(walkthroughDate).toISOString()
                      )
                    )
                  }
                >
                  {isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Calendar className="mr-2 h-4 w-4" />
                  )}
                  Schedule Walkthrough
                </Button>
              </div>
            )}
            <Button
              className="w-full"
              disabled={isPending}
              onClick={() =>
                handleAction(() => advanceWorkflowStage(workflow.id))
              }
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="mr-2 h-4 w-4" />
              )}
              Advance to Walkthrough
            </Button>
          </div>
        )}

        {currentStage === "walkthrough" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Complete the walkthrough and send to the estimator.
            </p>
            <Button
              className="w-full"
              disabled={isPending}
              onClick={() =>
                handleAction(() => advanceWorkflowStage(workflow.id))
              }
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="mr-2 h-4 w-4" />
              )}
              Walkthrough Complete → Send to Estimator
            </Button>
          </div>
        )}

        {currentStage === "estimating" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Estimate ready? Send it to the client for review.
            </p>
            <Button
              className="w-full"
              disabled={isPending}
              onClick={() =>
                handleAction(() => advanceWorkflowStage(workflow.id))
              }
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="mr-2 h-4 w-4" />
              )}
              Send Estimate to Client
            </Button>
          </div>
        )}

        {currentStage === "client_review" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Record the client&apos;s decision on the estimate.
            </p>
            <Button
              className="w-full"
              disabled={isPending}
              onClick={() =>
                handleAction(() => recordClientApproval(workflow.id))
              }
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Client Approved → Send to Admin
            </Button>
          </div>
        )}

        {currentStage === "admin_deposit" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Send contract, collect deposit, then advance.
            </p>
            <div>
              <Label htmlFor="deposit_amount">Deposit Amount ($)</Label>
              <Input
                id="deposit_amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
              />
            </div>
            <Button
              className="w-full"
              disabled={isPending || !depositAmount}
              onClick={() =>
                handleAction(() =>
                  recordDeposit(workflow.id, parseFloat(depositAmount))
                )
              }
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <DollarSign className="mr-2 h-4 w-4" />
              )}
              Deposit Received → Create Job Package
            </Button>
          </div>
        )}

        {currentStage === "job_package" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Create the job package and assign to a project manager.
            </p>
            {projectManagers.length > 0 && (
              <div>
                <Label>Assign Project Manager</Label>
                <Select value={selectedPm} onValueChange={setSelectedPm}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select PM" />
                  </SelectTrigger>
                  <SelectContent>
                    {projectManagers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.full_name || p.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              className="w-full"
              disabled={isPending}
              onClick={() =>
                handleAction(() =>
                  markJobPackageCreated(workflow.id, selectedPm)
                )
              }
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Package className="mr-2 h-4 w-4" />
              )}
              Hand Off to Project Manager
            </Button>
          </div>
        )}

        {currentStage === "project_management" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Workflow complete! The project is now with the project manager.
            </p>
          </div>
        )}

        {/* Cancel button */}
        <div className="pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground hover:text-destructive"
            disabled={isPending}
            onClick={() => handleAction(() => cancelWorkflow(workflow.id))}
          >
            <XCircle className="mr-2 h-4 w-4" />
            Cancel Workflow
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
