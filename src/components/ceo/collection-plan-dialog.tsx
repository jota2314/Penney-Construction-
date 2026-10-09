"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { PublishedCollectionPlan } from "@/lib/finance/published-collection-plan";
import type { CollectionInvoiceProjects } from "@/lib/finance/collection-invoices";
import { CollectionPlanCard } from "./collection-plan-card";

/** Shared collection workspace for CEO and Finance entry points. */
export function CollectionPlanDialog({ children, triggerClassName, plan, invoiceProjects }: {
  children: ReactNode;
  triggerClassName: string;
  plan: PublishedCollectionPlan;
  invoiceProjects: CollectionInvoiceProjects | null;
}) {
  return (
    <Dialog>
      <DialogTrigger className={triggerClassName}>{children}</DialogTrigger>
      <DialogContent aria-describedby={undefined} className="flex max-h-[94dvh] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[min(1200px,calc(100%-3rem))]">
        <DialogHeader className="shrink-0 border-b bg-card px-4 py-4 pr-12 text-left sm:px-6">
          <DialogTitle className="text-lg tracking-tight">Collection plan</DialogTitle>
          <p className="text-xs text-muted-foreground">Weekly priorities. Existing invoices. Clear next steps.</p>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          <CollectionPlanCard plan={plan} invoiceProjects={invoiceProjects} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
