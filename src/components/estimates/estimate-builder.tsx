"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, Trash2, ArrowRightCircle, ChevronDown, ChevronUp, CheckCircle2, Loader2, FileSpreadsheet, ExternalLink, MoreVertical, FileText, Home, MapPin, Clock, TrendingUp, FileBarChart, Mail } from "lucide-react";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EstimateStatusBadge } from "./estimate-status-badge";
import { EstimateFormDialog } from "./estimate-form-dialog";
import { EstimateDeleteDialog } from "./estimate-delete-dialog";
import { ConvertToProjectDialog } from "./convert-to-project-dialog";
import { LineItemsTable } from "./line-items-table";
import { EstimateFinancialBar } from "./estimate-financial-bar";
import { AIGeneratePanel } from "./ai-generate-panel";
import { EstimateCommandBar } from "./estimate-command-bar";
import { bulkCreateLineItems, approveEstimateAsContract } from "@/lib/actions/estimates";
import { PROJECT_TYPE_LABELS } from "@/lib/constants/project";
import { formatCurrency } from "@/lib/utils";
import { lineCost, linePrice, lineMarkupPct } from "@/lib/estimates/line-item-financials";
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

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Undo history stack — stores previous line item states
  type LineItemSnapshot = { description: string; proposal_description: string; total_price: number; total_cost?: number; markup_percentage?: number };
  const [undoStack, setUndoStack] = useState<LineItemSnapshot[][]>([]);

  const handleCommandEdit = useCallback(
    async (newItems: LineItemSnapshot[]) => {
      // Push current state to undo stack
      setUndoStack((prev) => [
        ...prev,
        lineItems.map((li) => ({
          description: li.description,
          proposal_description: li.proposal_description ?? "",
          total_price: linePrice(li),
          total_cost: lineCost(li),
          markup_percentage: lineMarkupPct(li),
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

  // Header metrics derived from line items (the "useful info" Jorge needs at a glance)
  const itemCount = lineItems.length;
  const subQuoteCount = lineItems.filter((li) => li.needs_sub_quote).length;
  const totalCostSum = lineItems.reduce((s, li) => s + lineCost(li), 0);
  const totalPriceSum = lineItems.reduce((s, li) => s + linePrice(li), 0);
  const profitSum = totalPriceSum - totalCostSum;
  const marginPct = totalPriceSum > 0 ? (profitSum / totalPriceSum) * 100 : 0;
  const marginColor = marginPct >= 25 ? "text-green-400" : marginPct >= 15 ? "text-amber-400" : "text-red-400";
  const profitColor = profitSum > 0 ? "text-green-400" : profitSum < 0 ? "text-red-400" : "text-muted-foreground";
  const updatedAtRelative = formatRelativeTime(estimate.updated_at);

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors max-w-full min-w-0"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" />
        <span className="truncate">{backLabel}</span>
      </Link>

      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-card to-card p-5 sm:p-7">
        {/* subtle amber glow */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" />

        <div className="relative space-y-4">
          {/* Top row: name + status */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <FileBarChart className="h-3.5 w-3.5" />
                Estimate
                <span className="text-amber-500/80">· v{estimate.version}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold leading-tight break-words">
                {estimate.name}
              </h1>
            </div>
            <EstimateStatusBadge status={estimate.status} />
          </div>

          {/* Context chips: project type + address + customer */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Home className="h-3.5 w-3.5 text-amber-500/80" />
              <span className="text-foreground">{projectTypeLabel}</span>
            </span>
            {contextAddress && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-amber-500/80" />
                <span className="truncate max-w-[260px] sm:max-w-none">{contextAddress}</span>
              </span>
            )}
            {contextName && (
              <span className="text-foreground/80">{contextName}</span>
            )}
          </div>

          {/* Hero total */}
          <div className="pt-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
              Contract Value
            </div>
            <div className="text-4xl sm:text-5xl font-bold tabular-nums leading-none mt-1">
              {formatCurrency(estimate.total_price, "two")}
            </div>
          </div>

          {/* Metrics strip: profit, margin, items, sub-quotes, updated */}
          {itemCount > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-sm">
              <span className={`inline-flex items-center gap-1.5 font-semibold tabular-nums ${profitColor}`}>
                <TrendingUp className="h-3.5 w-3.5" />
                {profitSum >= 0 ? "+" : ""}{formatCurrency(profitSum, "zero")} profit
              </span>
              <span className={`font-semibold tabular-nums ${marginColor}`}>
                {marginPct.toFixed(1)}% margin
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground tabular-nums">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </span>
              {subQuoteCount > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-500">
                  <Mail className="h-3.5 w-3.5" />
                  {subQuoteCount} need{subQuoteCount === 1 ? "s" : ""} sub quote
                </span>
              )}
              <span className="text-muted-foreground">·</span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                updated {updatedAtRelative}
              </span>
            </div>
          )}

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
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
            {projectContext && lineItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <FileSpreadsheet className="mr-2 h-4 w-4 text-green-500" />
                    Proposal
                    <ChevronDown className="ml-2 h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={pdfLoading}
                    onClick={async () => {
                      setPdfLoading(true);
                      try {
                        const res = await fetch(`/api/generate-proposal-pdf?projectId=${projectContext.projectId}&estimateId=${estimate.id}`);
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        setPdfUrl(url);
                      } catch {
                        alert("Failed to generate PDF");
                      } finally {
                        setPdfLoading(false);
                      }
                    }}
                  >
                    {pdfLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="mr-2 h-4 w-4" />
                    )}
                    {pdfLoading ? "Generating..." : "View PDF"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={sheetsLoading}
                    onClick={async () => {
                      setSheetsLoading(true);
                      try {
                        const res = await fetch(`/api/generate-proposal-sheets?projectId=${projectContext.projectId}&estimateId=${estimate.id}`);
                        const data = await res.json();
                        if (data.url) {
                          window.location.href = data.url;
                        } else {
                          alert(data.error || "Failed to create Google Sheet");
                        }
                      } catch {
                        alert("Failed to create Google Sheet");
                      } finally {
                        setSheetsLoading(false);
                      }
                    }}
                  >
                    {sheetsLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ExternalLink className="mr-2 h-4 w-4" />
                    )}
                    {sheetsLoading ? "Creating Sheet..." : "Open in Google Sheets"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDeleteOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {approveError && (
        <p className="text-sm text-destructive">{approveError}</p>
      )}

      {/* Meeting / site visit notes (if present) */}
      {(leadContext?.meetingSummary || (siteVisitContext && siteVisitContext.length > 0)) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground px-1">
          {leadContext?.meetingSummary && (
            <span className="italic truncate max-w-[280px] sm:max-w-[420px]">
              Meeting: {leadContext.meetingSummary.substring(0, 100)}
              {leadContext.meetingSummary.length > 100 ? "..." : ""}
            </span>
          )}
          {siteVisitContext?.map((sv, i) => (
            <span key={i} className="italic truncate max-w-[280px] sm:max-w-[420px]">
              Site Visit: {sv.name}
              {sv.summary ? ` — ${sv.summary.substring(0, 70)}${sv.summary.length > 70 ? "..." : ""}` : ""}
            </span>
          ))}
        </div>
      )}

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
            total_price: linePrice(li),
            total_cost: lineCost(li),
            markup_percentage: lineMarkupPct(li),
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
      {lineItems.length > 0 && (
        <EstimateFinancialBar lineItems={lineItems} />
      )}

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

      {pdfUrl && (
        <PdfViewer
          url={pdfUrl}
          filename={`${projectContext?.projectName ?? estimate.name} - Proposal.pdf`}
          onClose={() => {
            URL.revokeObjectURL(pdfUrl);
            setPdfUrl(null);
          }}
        />
      )}
    </div>
  );
}
