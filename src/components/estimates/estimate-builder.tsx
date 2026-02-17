"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EstimateStatusBadge } from "./estimate-status-badge";
import { EstimateFormDialog } from "./estimate-form-dialog";
import { EstimateDeleteDialog } from "./estimate-delete-dialog";
import { LineItemsTable } from "./line-items-table";
import { AIGeneratePanel } from "./ai-generate-panel";
import { PROJECT_TYPE_LABELS } from "@/lib/constants/project";
import type { Estimate, EstimateLineItem, EstimateFile, ProjectType } from "@/types/database";

interface EstimateBuilderProps {
  estimate: Estimate;
  lineItems: EstimateLineItem[];
  projectId: string;
  projectName: string;
  projectNumber: string;
  projectType: ProjectType;
  projectAddress?: string | null;
  projectDescription?: string | null;
  customerName?: string | null;
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
  projectId,
  projectName,
  projectNumber,
  projectType,
  projectAddress,
  projectDescription,
  customerName,
  estimateFiles,
}: EstimateBuilderProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [overviewText, setOverviewText] = useState(projectDescription ?? "");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link
              href={`/projects/${projectId}`}
              className="hover:underline flex items-center gap-1"
            >
              <ArrowLeft className="h-4 w-4" />
              {projectNumber} - {projectName}
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">{estimate.name}</h2>
            <EstimateStatusBadge status={estimate.status} />
            <span className="text-sm text-muted-foreground">
              v{estimate.version}
            </span>
            <span className="text-lg font-semibold ml-4">
              {formatCurrency(estimate.total_price)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Project Context Bar */}
      <div className="border rounded-md bg-muted/30 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <Badge variant="secondary" className="text-xs">
            {PROJECT_TYPE_LABELS[projectType]}
          </Badge>
          {customerName && <span>{customerName}</span>}
          {projectAddress && <span>{projectAddress}</span>}
        </div>
      </div>

      {/* AI Generate Panel */}
      <AIGeneratePanel
        estimateId={estimate.id}
        projectId={projectId}
        projectType={PROJECT_TYPE_LABELS[projectType]}
        projectName={projectName}
        projectAddress={projectAddress}
        projectDescription={projectDescription}
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
          projectId={projectId}
          lineItems={lineItems}
          projectContext={{
            projectType: PROJECT_TYPE_LABELS[projectType],
            projectName,
            projectAddress: projectAddress || undefined,
            projectOverview: overviewText || undefined,
          }}
        />
      </div>

      <EstimateFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={projectId}
        estimate={estimate}
      />

      <EstimateDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        estimate={estimate}
        projectId={projectId}
        redirectOnDelete
      />
    </div>
  );
}
