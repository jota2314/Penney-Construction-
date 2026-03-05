"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SiteVisitList } from "@/components/site-visits/site-visit-list";
import { SiteVisitFormDialog } from "@/components/site-visits/site-visit-form-dialog";
import { EstimationSiteVisitFormDialog } from "@/components/site-visits/estimation-site-visit-form-dialog";
import { Plus } from "lucide-react";
import type { SiteVisit, Project, Estimate } from "@/types/database";
import type { AppMode } from "@/types/auth";

interface SiteVisitWithProject extends SiteVisit {
  project?: Pick<Project, "project_number" | "name"> | null;
}

interface SiteVisitListPageProps {
  siteVisits: SiteVisitWithProject[];
  projects: Pick<Project, "id" | "project_number" | "name" | "status">[];
  estimates: Pick<Estimate, "id" | "name">[];
  mode: AppMode;
}

export function SiteVisitListPage({
  siteVisits,
  projects,
  estimates,
  mode,
}: SiteVisitListPageProps) {
  const [formOpen, setFormOpen] = useState(false);

  const isPrecon = mode === "precon";

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Site Visits</h2>
          <p className="text-muted-foreground text-sm">
            {isPrecon
              ? "Document site visits for estimation and pricing."
              : "Track construction progress and punch list visits."}
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="min-h-[44px]">
          <Plus className="mr-2 h-4 w-4" />
          New Site Visit
        </Button>
      </div>

      <SiteVisitList siteVisits={siteVisits} />

      {isPrecon ? (
        <EstimationSiteVisitFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          estimates={estimates}
        />
      ) : (
        <SiteVisitFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          projects={projects}
        />
      )}
    </>
  );
}
