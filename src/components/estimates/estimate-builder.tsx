"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, Trash2, ArrowRightCircle, ChevronDown, ChevronUp, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EstimateStatusBadge } from "./estimate-status-badge";
import { EstimateFormDialog } from "./estimate-form-dialog";
import { EstimateDeleteDialog } from "./estimate-delete-dialog";
import { ConvertToProjectDialog } from "./convert-to-project-dialog";
import { LineItemsTable } from "./line-items-table";
import { AIGeneratePanel } from "./ai-generate-panel";
import { EstimateCommandBar } from "./estimate-command-bar";
import { bulkCreateLineItems, approveEstimateAsContract } from "@/lib/actions/estimates";
import { PROJECT_TYPE_LABELS } from "@/lib/constants/project";
import { formatCurrency } from "@/lib/utils";
import type { Estimate, EstimateLineItem, EstimateFile, ProjectType } from "@/types/database";

interface ProjectContext {
  projectId: string;
  projectName: string;
  projectNumber: string;
  projectType: ProjectType;
  projectAddress?: string | null;
  projectDescription?: string | null;
  customerName?: string | null;
}

interface LeadContext {
  leadId: string;
  leadNumber: string;
  clientName: string;
  address?: string | null;
  projectType?: ProjectType | null;
  description?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  meetingSummary?: string | null;
  meetingQA?: string | null;
}

interface SiteVisitContextItem {
  name: string;
  summary: string | null;
  notes: string[];
}

interface TradeRateForAI {
  trade_name: string;
  unit_type: string;
  avg_cost: number;
  avg_price: number;
}

interface EstimateBuilderProps {
  estimate: Estimate;
  lineItems: EstimateLineItem[];
  projectContext?: ProjectContext | null;
  leadContext?: LeadContext | null;
  estimateFiles: EstimateFile[];
  siteVisitContext?: SiteVisitContextItem[];
  tradeRates?: TradeRateForAI[];
}

export function EstimateBuilder({
  estimate,
  lineItems,
  projectContext,
  leadContext,
  estimateFiles,
  siteVisitContext,
  tradeRates,
}: EstimateBuilderProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(lineItems.length === 0);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  // Undo history stack — stores previous line item states
  type LineItemSnapshot = { description: string; proposal_description: string; total_price: number };
  const [undoStack, setUndoStack] = useState<LineItemSnapshot[][]>([]);

  const handleCommandEdit = useCallback(
    async (newItems: LineItemSnapshot[]) => {
      // Push current state to undo stack
      setUndoStack((prev) => [
        ...prev,
        lineItems.map((li) => ({
          description: li.description,
          proposal_description: li.proposal_description ?? "",
          total_price: li.total_price,
        })),
      ]);

      // Save to DB and refresh
      await bulkCreateLineItems(estimate.id, newItems, "replace");
      router.refresh();
    },
    [lineItems, estimate.id, router]
  );

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    await bulkCreateLineItems(estimate.id, previous, "replace");
    router.refresh();
  }, [undoStack, estimate.id, router]);

  const handleApproveAsContract = useCallback(async () => {
    if (!confirm("Approve this estimate as the contract? This will set the project's contract value and mark it as contracted.")) return;
    setApproving(true);
    setApproveError(null);
    const result = await approveEstimateAsContract(estimate.id);
    setApproving(false);
    if (result.error) {
      setApproveError(result.error);
    } else {
      router.refresh();
    }
  }, [estimate.id, router]);

  const projectType = projectContext?.projectType ?? leadContext?.projectType ?? "other";
  const projectTypeLabel = PROJECT_TYPE_LABELS[projectType];
  // Build initial overview: use existing description, or pre-fill from site visit notes
  const existingDescription = projectContext?.projectDescription ?? leadContext?.description ?? estimate.description ?? "";
  const siteVisitPrefill = !existingDescription && siteVisitContext?.length
    ? siteVisitContext.map((sv) => {
        const parts: string[] = [];
        if (sv.summary) parts.push(sv.summary);
        else if (sv.notes.length > 0) parts.push(sv.notes.join("\n"));
        return parts.join("\n");
      }).filter(Boolean).join("\n\n")
    : "";
  const overviewSource = existingDescription || siteVisitPrefill;
  const [overviewText, setOverviewText] = useState(overviewSource);

  const backHref = projectContext
    ? `/projects/${projectContext.projectId}`
    : leadContext
      ? `/crm/leads/${leadContext.leadId}`
      : "/estimates";

  const backLabel = projectContext
    ? `${projectContext.projectNumber} - ${projectContext.projectName}`
    : leadContext
      ? `${leadContext.leadNumber} - ${leadContext.clientName}`
      : "All Estimates";

  const contextName = projectContext?.customerName ?? leadContext?.clientName ?? null;
  const contextAddress = projectContext?.projectAddress ?? leadContext?.address ?? null;

  // Build site visit notes string for AI context
  const siteVisitNotes = siteVisitContext
    ?.map((sv) => {
      const parts = [`Site Visit: ${sv.name}`];
      if (sv.summary) parts.push(`Summary: ${sv.summary}`);
      if (sv.notes.length > 0) parts.push(`Notes:\n${sv.notes.join("\n")}`);
      return parts.join("\n");
    })
    .join("\n\n") || undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link
              href={backHref}
              className="hover:underline flex items-center gap-1 min-w-0"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              <span className="truncate">{backLabel}</span>
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-2xl font-bold">{estimate.name}</h2>
            <EstimateStatusBadge status={estimate.status} />
            <span className="text-sm text-muted-foreground">
              v{estimate.version}
            </span>
            <span className="text-lg font-semibold">
              {formatCurrency(estimate.total_price, "two")}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {leadContext && !projectContext && (
            <Button variant="default" onClick={() => setConvertOpen(true)}>
              <ArrowRightCircle className="mr-2 h-4 w-4" />
              Convert to Project
            </Button>
          )}
          {projectContext && estimate.status !== "approved" && lineItems.length > 0 && (
            <Button
              variant="default"
              className="bg-green-600 hover:bg-green-700"
              onClick={handleApproveAsContract}
              disabled={approving}
            >
              {approving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              {approving ? "Approving..." : "Approve as Contract"}
            </Button>
          )}
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {approveError && (
        <p className="text-sm text-destructive">{approveError}</p>
      )}

      {/* Context Bar */}
      <div className="border rounded-md bg-muted/30 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <Badge variant="secondary" className="text-xs">
            {projectTypeLabel}
          </Badge>
          {contextName && <span>{contextName}</span>}
          {contextAddress && <span>{contextAddress}</span>}
          {leadContext?.meetingSummary && (
            <span className="text-xs italic truncate max-w-[200px] sm:max-w-[300px]">
              Meeting: {leadContext.meetingSummary.substring(0, 80)}
              {leadContext.meetingSummary.length > 80 ? "..." : ""}
            </span>
          )}
          {siteVisitContext && siteVisitContext.length > 0 && (
            <>
              {siteVisitContext.map((sv, i) => (
                <span key={i} className="text-xs italic truncate max-w-[200px] sm:max-w-[300px]">
                  Site Visit: {sv.name}
                  {sv.summary ? ` — ${sv.summary.substring(0, 60)}${sv.summary.length > 60 ? "..." : ""}` : ""}
                </span>
              ))}
            </>
          )}
        </div>
      </div>

      {/* AI Generate Panel — collapsible after line items exist */}
      {lineItems.length > 0 && !aiPanelOpen ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setAiPanelOpen(true)}
        >
          <ChevronDown className="mr-2 h-4 w-4" />
          AI Estimate Generator
        </Button>
      ) : (
        <div>
          {lineItems.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mb-2 text-xs"
              onClick={() => setAiPanelOpen(false)}
            >
              <ChevronUp className="mr-1 h-3.5 w-3.5" />
              Collapse
            </Button>
          )}
          <AIGeneratePanel
            estimateId={estimate.id}
            projectId={projectContext?.projectId}
            leadId={leadContext?.leadId}
            projectType={projectTypeLabel}
            projectName={projectContext?.projectName ?? leadContext?.clientName ?? ""}
            projectAddress={contextAddress}
            projectDescription={overviewSource}
            existingFiles={estimateFiles}
            hasExistingLineItems={lineItems.length > 0}
            onGenerationComplete={() => router.refresh()}
            overviewText={overviewText}
            onOverviewChange={setOverviewText}
            siteVisitNotes={siteVisitNotes}
            meetingQA={leadContext?.meetingQA}
            tradeRates={tradeRates}
          />
        </div>
      )}

      {/* Voice/text command bar for editing — shown when line items exist */}
      {lineItems.length > 0 && (
        <EstimateCommandBar
          currentLineItems={lineItems.map((li) => ({
            description: li.description,
            proposal_description: li.proposal_description ?? "",
            total_price: li.total_price,
          }))}
          projectContext={{
            projectName: projectContext?.projectName ?? leadContext?.clientName,
            projectType: projectTypeLabel,
          }}
          onApplyEdit={handleCommandEdit}
          onUndo={handleUndo}
          canUndo={undoStack.length > 0}
          historyCount={undoStack.length}
        />
      )}

      {/* Notes */}
      {estimate.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{estimate.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Line Items */}
      <div>
        <h3 className="text-lg font-semibold mb-3">
          Line Items ({lineItems.length})
        </h3>
        <LineItemsTable
          estimateId={estimate.id}
          lineItems={lineItems}
          projectContext={{
            projectType: projectTypeLabel,
            projectName: projectContext?.projectName ?? leadContext?.clientName ?? "",
            projectAddress: contextAddress || undefined,
            projectOverview: overviewText || undefined,
          }}
          tradeRates={tradeRates}
        />
      </div>

      <EstimateFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={projectContext?.projectId}
        leadId={leadContext?.leadId}
        estimate={estimate}
      />

      <EstimateDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        estimate={estimate}
        redirectTo={backHref}
      />

      {leadContext && !projectContext && (
        <ConvertToProjectDialog
          open={convertOpen}
          onOpenChange={setConvertOpen}
          leadId={leadContext.leadId}
          estimateId={estimate.id}
          clientName={leadContext.clientName}
        />
      )}
    </div>
  );
}
