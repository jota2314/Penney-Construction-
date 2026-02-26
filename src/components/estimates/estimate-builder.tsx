"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, Trash2, ArrowRightCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EstimateStatusBadge } from "./estimate-status-badge";
import { EstimateFormDialog } from "./estimate-form-dialog";
import { EstimateDeleteDialog } from "./estimate-delete-dialog";
import { ConvertToProjectDialog } from "./convert-to-project-dialog";
import { LineItemsTable } from "./line-items-table";
import { AIGeneratePanel } from "./ai-generate-panel";
import { PROJECT_TYPE_LABELS } from "@/lib/constants/project";
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
}

interface EstimateBuilderProps {
  estimate: Estimate;
  lineItems: EstimateLineItem[];
  projectContext?: ProjectContext | null;
  leadContext?: LeadContext | null;
  estimateFiles: EstimateFile[];
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(val);

export function EstimateBuilder({
  estimate,
  lineItems,
  projectContext,
  leadContext,
  estimateFiles,
}: EstimateBuilderProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const projectType = projectContext?.projectType ?? leadContext?.projectType ?? "other";
  const projectTypeLabel = PROJECT_TYPE_LABELS[projectType];
  const overviewSource = projectContext?.projectDescription ?? leadContext?.description ?? estimate.description ?? "";
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
              {formatCurrency(estimate.total_price)}
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
        </div>
      </div>

      {/* AI Generate Panel */}
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
      />

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
