"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SiteVisitList } from "@/components/site-visits/site-visit-list";
import { SiteVisitFormDialog } from "@/components/site-visits/site-visit-form-dialog";
import { Plus } from "lucide-react";
import type { SiteVisit, Project } from "@/types/database";

interface SiteVisitWithProject extends SiteVisit {
  project?: Pick<Project, "project_number" | "name"> | null;
}

interface SiteVisitListPageProps {
  siteVisits: SiteVisitWithProject[];
  projects: Pick<Project, "id" | "project_number" | "name" | "status">[];
}

export function SiteVisitListPage({
  siteVisits,
  projects,
}: SiteVisitListPageProps) {
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Site Visits</h2>
          <p className="text-muted-foreground text-sm">
            Document project site visits with notes and photos.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="min-h-[44px]">
          <Plus className="mr-2 h-4 w-4" />
          New Site Visit
        </Button>
      </div>

      <SiteVisitList siteVisits={siteVisits} />

      <SiteVisitFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projects={projects}
      />
    </>
  );
}
