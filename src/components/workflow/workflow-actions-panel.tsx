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
  confirmSchedule,
  rescheduleWalkthrough,
  completeWalkthrough,
  linkEstimateSheet,
  submitEstimateForReview,
  ownerApproveEstimate,
  clientApprove,
  recordDepositAndPermit,
  permitPulled,
  markJobPackageCreated,
  pmHandoff,
  startConstruction,
  completeRoughInspection,
  completeFinalInspection,
  completeAudit,
  cancelWorkflow,
} from "@/lib/actions/workflow";
import type { WorkflowInstance, Profile } from "@/types/database";
import {
  CheckCircle,
  CalendarClock,
  Camera,
  FileSpreadsheet,
  ThumbsUp,
  Send,
  Receipt,
  FileCheck,
  Package,
  UserCheck,
  HardHat,
  ClipboardCheck,
  Shield,
  Ban,
  Loader2,
} from "lucide-react";

interface WorkflowActionsPanelProps {
  workflow: WorkflowInstance;
  profiles: Profile[];
}

export function WorkflowActionsPanel({
  workflow,
  profiles,
}: WorkflowActionsPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  function handleAction(action: () => Promise<{ error: string | null }>, successMsg: string) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(successMsg);
        router.refresh();
      }
    });
  }

  const pms = profiles.filter((p) => p.role === "project_manager" || p.role === "owner");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Actions</CardTitle>
        <CardDescription>Next step for this workflow</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md p-2">
            {error}
          </div>
        )}
        {success && (
          <div className="text-sm text-green-700 bg-green-50 rounded-md p-2">
            {success}
          </div>
        )}

        {/* ── Lead Intake ── */}
        {workflow.current_stage === "lead_intake" && (
          <Button
            className="w-full"
            onClick={() => handleAction(
              () => confirmSchedule(workflow.id),
              "Moved to schedule confirmation"
            )}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send to Estimator for Confirmation
          </Button>
        )}

        {/* ── Schedule Confirmation ── */}
        {workflow.current_stage === "schedule_confirmation" && (
          <ScheduleConfirmationActions
            workflowId={workflow.id}
            currentDate={workflow.walkthrough_date}
            isPending={isPending}
            onAction={handleAction}
          />
        )}

        {/* ── Walkthrough ── */}
        {workflow.current_stage === "walkthrough" && (
          <Button
            className="w-full"
            onClick={() => handleAction(
              () => completeWalkthrough(workflow.id),
              "Walkthrough completed"
            )}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
            Complete Walkthrough
          </Button>
        )}

        {/* ── Estimating ── */}
        {workflow.current_stage === "estimating" && (
          <EstimatingActions
            workflowId={workflow.id}
            currentSheetUrl={workflow.google_sheet_url}
            isPending={isPending}
            onAction={handleAction}
          />
        )}

        {/* ── Owner Review ── */}
        {workflow.current_stage === "owner_review" && (
          <>
            {workflow.google_sheet_url && (
              <a
                href={workflow.google_sheet_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline mb-2"
              >
                <FileSpreadsheet className="h-4 w-4" />
                View Estimate Sheet
              </a>
            )}
            <Button
              className="w-full"
              onClick={() => handleAction(
                () => ownerApproveEstimate(workflow.id),
                "Estimate approved — sent to client"
              )}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ThumbsUp className="mr-2 h-4 w-4" />}
              Approve & Send to Client
            </Button>
          </>
        )}

        {/* ── Client Review ── */}
        {workflow.current_stage === "client_review" && (
          <>
            <p className="text-xs text-muted-foreground">
              Waiting for client approval via email link, or approve manually below.
            </p>
            <Button
              className="w-full"
              onClick={() => handleAction(
                () => clientApprove(workflow.id),
                "Client approved — moving to permit & deposit"
              )}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              Manually Approve (Client Confirmed)
            </Button>
          </>
        )}

        {/* ── Permit & Deposit ── */}
        {workflow.current_stage === "permit_deposit" && (
          <PermitDepositActions
            workflowId={workflow.id}
            isPending={isPending}
            onAction={handleAction}
          />
        )}

        {/* ── Job Package ── */}
        {workflow.current_stage === "job_package" && (
          <JobPackageActions
            workflowId={workflow.id}
            pms={pms}
            isPending={isPending}
            onAction={handleAction}
          />
        )}

        {/* ── PM Handoff ── */}
        {workflow.current_stage === "pm_handoff" && (
          <Button
            className="w-full"
            onClick={() => handleAction(
              () => pmHandoff(workflow.id),
              "PM has received the project"
            )}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
            PM Acknowledged — Start Project
          </Button>
        )}

        {/* ── Construction Started ── */}
        {workflow.current_stage === "construction_started" && (
          <Button
            className="w-full"
            onClick={() => handleAction(
              () => startConstruction(workflow.id),
              "Moving to rough inspection"
            )}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <HardHat className="mr-2 h-4 w-4" />}
            Rough Work Complete — Ready for Inspection
          </Button>
        )}

        {/* ── Rough Inspection ── */}
        {workflow.current_stage === "rough_inspection" && (
          <Button
            className="w-full"
            onClick={() => handleAction(
              () => completeRoughInspection(workflow.id),
              "Rough inspection passed"
            )}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
            Rough Inspection Passed
          </Button>
        )}

        {/* ── Final Inspection ── */}
        {workflow.current_stage === "final_inspection" && (
          <Button
            className="w-full"
            onClick={() => handleAction(
              () => completeFinalInspection(workflow.id),
              "Final inspection passed"
            )}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shield className="mr-2 h-4 w-4" />}
            Final Inspection Passed
          </Button>
        )}

        {/* ── Audit ── */}
        {workflow.current_stage === "audit" && (
          <Button
            className="w-full"
            onClick={() => handleAction(
              () => completeAudit(workflow.id),
              "Audit complete — project closed"
            )}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
            Complete Audit — Close Project
          </Button>
        )}

        {/* Cancel */}
        {workflow.status === "active" && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={() => handleAction(
              () => cancelWorkflow(workflow.id),
              "Workflow cancelled"
            )}
            disabled={isPending}
          >
            <Ban className="mr-2 h-3 w-3" />
            Cancel Workflow
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Sub-components ───────────────────────────────────────────

function ScheduleConfirmationActions({
  workflowId, currentDate, isPending, onAction,
}: {
  workflowId: string;
  currentDate: string | null;
  isPending: boolean;
  onAction: (action: () => Promise<{ error: string | null }>, msg: string) => void;
}) {
  const [showReschedule, setShowReschedule] = useState(false);
  const [newDate, setNewDate] = useState("");

  return (
    <div className="space-y-2">
      {currentDate && (
        <p className="text-xs text-muted-foreground">
          Scheduled: {new Date(currentDate).toLocaleString()}
        </p>
      )}
      <Button
        className="w-full"
        onClick={() => onAction(
          () => confirmSchedule(workflowId),
          "Schedule confirmed — ready for walkthrough"
        )}
        disabled={isPending}
      >
        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
        Confirm Schedule
      </Button>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => setShowReschedule(!showReschedule)}
        disabled={isPending}
      >
        <CalendarClock className="mr-2 h-4 w-4" />
        Reschedule
      </Button>
      {showReschedule && (
        <div className="space-y-2 pt-1">
          <Input
            type="datetime-local"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
          />
          <Button
            size="sm"
            className="w-full"
            disabled={!newDate || isPending}
            onClick={() => onAction(
              () => rescheduleWalkthrough(workflowId, new Date(newDate).toISOString()),
              "Rescheduled — client notified"
            )}
          >
            Send New Date to Client
          </Button>
        </div>
      )}
    </div>
  );
}

function EstimatingActions({
  workflowId, currentSheetUrl, isPending, onAction,
}: {
  workflowId: string;
  currentSheetUrl: string | null;
  isPending: boolean;
  onAction: (action: () => Promise<{ error: string | null }>, msg: string) => void;
}) {
  const [sheetUrl, setSheetUrl] = useState(currentSheetUrl || "");
  const [amount, setAmount] = useState("");

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Google Sheet URL</Label>
        <Input
          placeholder="Paste Google Sheets link..."
          value={sheetUrl}
          onChange={(e) => setSheetUrl(e.target.value)}
        />
        {sheetUrl && sheetUrl !== currentSheetUrl && (
          <Button
            size="sm"
            variant="outline"
            className="w-full mt-1"
            disabled={isPending}
            onClick={() => onAction(
              () => linkEstimateSheet(workflowId, sheetUrl),
              "Estimate sheet linked"
            )}
          >
            <FileSpreadsheet className="mr-2 h-3 w-3" />
            Link Sheet
          </Button>
        )}
        {currentSheetUrl && (
          <a href={currentSheetUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs text-primary hover:underline mt-1 block">
            View linked sheet
          </a>
        )}
      </div>
      <div>
        <Label className="text-xs">Estimate Amount ($)</Label>
        <Input
          type="number"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <Button
        className="w-full"
        disabled={isPending}
        onClick={() => onAction(
          () => submitEstimateForReview(workflowId, amount ? parseFloat(amount) : undefined),
          "Estimate submitted for owner review"
        )}
      >
        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
        Submit for Owner Review
      </Button>
    </div>
  );
}

function PermitDepositActions({
  workflowId, isPending, onAction,
}: {
  workflowId: string;
  isPending: boolean;
  onAction: (action: () => Promise<{ error: string | null }>, msg: string) => void;
}) {
  const [depositAmount, setDepositAmount] = useState("");

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Deposit Amount ($)</Label>
        <Input
          type="number"
          placeholder="30% deposit amount"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
        />
      </div>
      <Button
        variant="outline"
        className="w-full"
        disabled={isPending || !depositAmount}
        onClick={() => onAction(
          () => recordDepositAndPermit(workflowId, parseFloat(depositAmount)),
          "Deposit recorded"
        )}
      >
        <Receipt className="mr-2 h-4 w-4" />
        Record Deposit Received
      </Button>
      <Button
        className="w-full"
        disabled={isPending}
        onClick={() => onAction(
          () => permitPulled(workflowId),
          "Permit pulled — moving to job package"
        )}
      >
        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck className="mr-2 h-4 w-4" />}
        Permit Pulled — Ready for Job Package
      </Button>
    </div>
  );
}

function JobPackageActions({
  workflowId, pms, isPending, onAction,
}: {
  workflowId: string;
  pms: Profile[];
  isPending: boolean;
  onAction: (action: () => Promise<{ error: string | null }>, msg: string) => void;
}) {
  const [selectedPm, setSelectedPm] = useState("");

  return (
    <div className="space-y-3">
      {pms.length > 0 && (
        <div>
          <Label className="text-xs">Assign Project Manager</Label>
          <Select value={selectedPm} onValueChange={setSelectedPm}>
            <SelectTrigger>
              <SelectValue placeholder="Select PM" />
            </SelectTrigger>
            <SelectContent>
              {pms.map((p) => (
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
        onClick={() => onAction(
          () => markJobPackageCreated(workflowId, selectedPm || undefined),
          "Job package created — handing off to PM"
        )}
      >
        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Package className="mr-2 h-4 w-4" />}
        Job Package Created — Hand Off to PM
      </Button>
    </div>
  );
}
