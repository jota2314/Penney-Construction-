"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SiteVisitStatusBadge } from "./site-visit-status-badge";
import { SiteVisitDeleteDialog } from "./site-visit-delete-dialog";
import { SiteVisitNotesPanel } from "./site-visit-notes-panel";
import { SiteVisitPhotosPanel } from "./site-visit-photos-panel";
import { SiteVisitSummaryPanel } from "./site-visit-summary-panel";
import { completeSiteVisit } from "@/lib/actions/site-visits";
import {
  FolderKanban,
  Calendar,
  ArrowLeft,
  CheckCircle,
  Trash2,
  ClipboardList,
} from "lucide-react";
import type { SiteVisit, SiteVisitNote, SiteVisitFile, Project } from "@/types/database";

interface SiteVisitDetailProps {
  siteVisit: SiteVisit;
  project: Project;
  notes: SiteVisitNote[];
  files: SiteVisitFile[];
}

export function SiteVisitDetail({
  siteVisit,
  project,
  notes,
  files,
}: SiteVisitDetailProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [completing, setCompleting] = useState(false);

  const isInProgress = siteVisit.status === "in_progress";

  const address = project.address
    ? `${project.address}${project.city ? `, ${project.city}` : ""}${project.state ? `, ${project.state}` : ""}${project.zip ? ` ${project.zip}` : ""}`
    : null;

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

      {/* Header - mobile friendly */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">Site Visit</h2>
            <SiteVisitStatusBadge status={siteVisit.status} />
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Visit info card */}
        <Card>
          <CardContent className="py-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
              <Link
                href={`/projects/${project.id}`}
                className="hover:underline"
              >
                <span className="font-mono">{project.project_number}</span> —{" "}
                {project.name}
              </Link>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {new Date(siteVisit.visited_at).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}{" "}
              at{" "}
              {new Date(siteVisit.visited_at).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
            {siteVisit.purpose && (
              <div className="flex items-center gap-2 text-sm">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                {siteVisit.purpose}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Mark complete button - large touch target */}
        {isInProgress && (
          <Button
            size="lg"
            className="w-full h-12 text-base"
            disabled={completing}
            onClick={handleComplete}
          >
            <CheckCircle className="mr-2 h-5 w-5" />
            {completing ? "Completing..." : "Mark Complete"}
          </Button>
        )}
      </div>

      {/* Tabs - main content area */}
      <Tabs defaultValue="notes" className="mt-4">
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="notes" className="min-h-[44px] text-xs sm:text-sm">
            Notes ({notes.length})
          </TabsTrigger>
          <TabsTrigger value="photos" className="min-h-[44px] text-xs sm:text-sm">
            Photos ({files.length})
          </TabsTrigger>
          <TabsTrigger value="summary" className="min-h-[44px] text-xs sm:text-sm">
            Summary
          </TabsTrigger>
        </TabsList>
        <TabsContent value="notes" className="mt-4">
          <SiteVisitNotesPanel siteVisitId={siteVisit.id} notes={notes} />
        </TabsContent>
        <TabsContent value="photos" className="mt-4">
          <SiteVisitPhotosPanel
            siteVisitId={siteVisit.id}
            projectId={siteVisit.project_id}
            files={files}
          />
        </TabsContent>
        <TabsContent value="summary" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Site Visit Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <SiteVisitSummaryPanel
                siteVisitId={siteVisit.id}
                summary={siteVisit.summary}
                notes={notes}
                files={files}
                projectName={project.name}
                projectType={project.project_type}
                address={address}
              />
            </CardContent>
          </Card>
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
