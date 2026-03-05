"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EstimateList } from "@/components/estimates/estimate-list";
import { EstimateFormDialog } from "@/components/estimates/estimate-form-dialog";
import { Plus } from "lucide-react";
import type { Estimate } from "@/types/database";

interface EstimateWithContext extends Estimate {
  project?: { name: string; project_number: string } | null;
  lead?: {
    first_name: string;
    last_name: string;
    lead_number: string;
  } | null;
}

interface SiteVisitOption {
  id: string;
  name: string | null;
  address: string | null;
  visited_at: string;
  visit_type: string;
  estimate_id: string | null;
  purpose: string | null;
  city: string | null;
  project?: { name: string; address: string | null; city: string | null } | null;
}

interface EstimateListPageProps {
  estimates: EstimateWithContext[];
  availableSiteVisits?: SiteVisitOption[];
}

export function EstimateListPage({
  estimates,
  availableSiteVisits = [],
}: EstimateListPageProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Estimates</h2>
          <p className="text-muted-foreground text-sm">
            Create and manage project estimates.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="min-h-[44px]">
          <Plus className="mr-2 h-4 w-4" />
          New Estimate
        </Button>
      </div>

      <EstimateList estimates={estimates} />

      <EstimateFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        availableSiteVisits={availableSiteVisits}
        onCreated={(estimateId, projectId) => {
          if (projectId) {
            router.push(`/projects/${projectId}/estimates/${estimateId}`);
          } else {
            router.push(`/estimates/${estimateId}`);
          }
        }}
      />
    </>
  );
}
