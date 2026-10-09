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
      <DialogContent aria-describedby={undefined} className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>Left to collect</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-3 sm:p-5">
          <CollectionPlanCard plan={plan} invoiceProjects={invoiceProjects} expanded />
        </div>
      </DialogContent>
    </Dialog>
  );
}
