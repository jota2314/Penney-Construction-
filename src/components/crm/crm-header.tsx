"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { LeadFormDialog } from "@/components/leads/lead-form-dialog";

export function CrmHeader() {
  const [formOpen, setFormOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Sales Pipeline
          </h2>
          <p className="text-muted-foreground text-sm">
            Track leads from first call to project kickoff.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Lead
        </Button>
      </div>
      <LeadFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={(leadId) => router.push(`/crm/leads/${leadId}`)}
      />
    </>
  );
}
