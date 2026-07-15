"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WalkthroughList } from "@/components/walkthroughs/walkthrough-list";
import { WalkthroughFormDialog, type WalkthroughProjectOption } from "@/components/walkthroughs/walkthrough-form-dialog";
import { Plus } from "lucide-react";
import type { Walkthrough, Estimate } from "@/types/database";

interface WalkthroughListPageProps {
  walkthroughs: Walkthrough[];
  estimates: Pick<Estimate, "id" | "name">[];
  projects: WalkthroughProjectOption[];
  /** Auto-open the new-walkthrough form (deep link: /walkthroughs?new=1). */
  initialFormOpen?: boolean;
}

export function WalkthroughListPage({
  walkthroughs,
  estimates,
  projects,
  initialFormOpen = false,
}: WalkthroughListPageProps) {
  const [formOpen, setFormOpen] = useState(initialFormOpen);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Walkthroughs</h2>
          <p className="text-muted-foreground text-sm">
            Document pre-construction site walkthroughs for estimation and pricing.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="min-h-[44px]">
          <Plus className="mr-2 h-4 w-4" />
          New Walkthrough
        </Button>
      </div>

      <WalkthroughList walkthroughs={walkthroughs} />

      <WalkthroughFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        estimates={estimates}
        projects={projects}
      />
    </>
  );
}
