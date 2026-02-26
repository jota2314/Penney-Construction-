"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { LeadList } from "./lead-list";
import { LeadFormDialog } from "./lead-form-dialog";
import type { Lead } from "@/types/database";

interface LeadsPageContentProps {
  leads: Lead[];
}

export function LeadsPageContent({ leads }: LeadsPageContentProps) {
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Leads</h2>
          <p className="text-muted-foreground text-sm">
            Track incoming leads from initial contact.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Lead
        </Button>
      </div>
      <LeadList leads={leads} />
      <LeadFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </>
  );
}
