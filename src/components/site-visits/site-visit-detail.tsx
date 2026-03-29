"use client";

import { useState } from "react";
import Link from "next/link";
import { buildAddress } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SiteVisitStatusBadge } from "./site-visit-status-badge";
import { SiteVisitTypeBadge } from "./site-visit-type-badge";
import { SiteVisitDeleteDialog } from "./site-visit-delete-dialog";
import { SiteVisitCapturePanel } from "./site-visit-capture-panel";
import { SiteVisitReviewPanel } from "./site-visit-review-panel";
import { completeSiteVisit } from "@/lib/actions/site-visits";
import {
  ArrowLeft,
  CheckCircle,
  Trash2,
} from "lucide-react";
import type { SiteVisit, SiteVisitNote, SiteVisitFile, Project } from "@/types/database";

interface SiteVisitDetailProps {
  siteVisit: SiteVisit;
  project: Project | null;
  customer: { first_name: string; last_name: string; phone?: string | null; email?: string | null } | null;
  notes: SiteVisitNote[];
  files: SiteVisitFile[];
}

export function SiteVisitDetail({
  siteVisit,
  project,
  customer,
  notes: initialNotes,
  files: initialFiles,
}: SiteVisitDetailProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [completing, setCompleting] = useState(false);

  // Lifted state — shared between capture and review panels
  const [liveNotes, setLiveNotes] = useState(initialNotes);
  const [liveFiles, setLiveFiles] = useState(initialFiles);

  const isInProgress = siteVisit.status === "in_progress";

  const address = buildAddress(project?.address, project?.city, project?.state, project?.zip);

  async function handleComplete() {
    setCompleting(true);
    await completeSiteVisit(siteVisit.id);
    setCompleting(false);
  }

  return (
    <>
      {/* Back link */}
      <Link
        href="/site-visits"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-2"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        All Site Visits
      </Link>

      {/* Compact header bar */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {project ? (
              <Link
                href={`/projects/${project.id}`}
                className="text-sm font-semibold hover:underline truncate"
              >
                <span className="font-mono">{project.project_number}</span>
                {" — "}
                {project.name}
              </Link>
            ) : (
              <span className="text-sm font-semibold truncate">
                Site Visit
              </span>
            )}
            <SiteVisitTypeBadge type={siteVisit.visit_type} siteVisitId={siteVisit.id} />
            <SiteVisitStatusBadge status={siteVisit.status} />
          </div>
          {address && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {address}
            </p>
          )}
          {siteVisit.purpose && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {siteVisit.purpose}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isInProgress && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={completing}
              onClick={handleComplete}
            >
              <CheckCircle className="mr-1 h-3.5 w-3.5" />
              {completing ? "..." : "Complete"}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Tabs: Capture | Review | Report */}
      <Tabs defaultValue="capture" className="mt-2">
        <TabsList className="w-full grid grid-cols-3 !h-auto !p-1 rounded-lg bg-muted/50 border border-border">
          <TabsTrigger
            value="capture"
            className="!h-9 text-sm font-medium rounded-md transition-colors data-[state=active]:bg-orange-500 data-[state=active]:text-white data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground"
          >
            Capture
          </TabsTrigger>
          <TabsTrigger
            value="review"
            className="!h-9 text-sm font-medium rounded-md transition-colors data-[state=active]:bg-orange-500 data-[state=active]:text-white data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground"
          >
            Review
          </TabsTrigger>
          <TabsTrigger
            value="report"
            className="!h-9 text-sm font-medium rounded-md transition-colors data-[state=active]:bg-orange-500 data-[state=active]:text-white data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground"
          >
            Report
          </TabsTrigger>
        </TabsList>
        <TabsContent value="capture" className="mt-3">
          <SiteVisitCapturePanel
            siteVisitId={siteVisit.id}
            projectId={siteVisit.project_id}
            notes={liveNotes}
            files={liveFiles}
            onNotesChange={setLiveNotes}
            onFilesChange={setLiveFiles}
          />
        </TabsContent>
        <TabsContent value="review" className="mt-3">
          <SiteVisitReviewPanel
            siteVisitId={siteVisit.id}
            summary={siteVisit.summary}
            notes={liveNotes}
            files={liveFiles}
            projectName={project?.name}
            projectNumber={project?.project_number}
            projectType={project?.project_type}
            projectStatus={project?.status}
            customerName={customer ? `${customer.first_name} ${customer.last_name}` : undefined}
            address={address}
            visitDate={siteVisit.visited_at}
            purpose={siteVisit.purpose}
            visitType={siteVisit.visit_type}
          />
        </TabsContent>
        <TabsContent value="report" className="mt-3">
          <SiteVisitReviewPanel
            siteVisitId={siteVisit.id}
            summary={siteVisit.summary}
            notes={liveNotes}
            files={liveFiles}
            projectName={project?.name}
            projectNumber={project?.project_number}
            projectType={project?.project_type}
            customerName={customer ? `${customer.first_name} ${customer.last_name}` : undefined}
            address={address}
            visitDate={siteVisit.visited_at}
            purpose={siteVisit.purpose}
            reportMode
          />
        </TabsContent>
      </Tabs>

      {/* Delete dialog */}
      <SiteVisitDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        siteVisit={siteVisit}
        redirectOnDelete
      />
    </>
  );
}
