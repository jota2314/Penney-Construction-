"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createEstimateFromLead } from "@/lib/actions/leads";
import type { Lead } from "@/types/database";

interface ConvertLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
}

export function ConvertLeadDialog({
  open,
  onOpenChange,
  lead,
}: ConvertLeadDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleCreate() {
    setLoading(true);
    setError(null);

    const result = await createEstimateFromLead(lead.id);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
      if (result.estimateId) {
        router.push(`/estimates/${result.estimateId}`);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Estimate</DialogTitle>
          <DialogDescription>
            This will create a new estimate for{" "}
            <strong>
              {lead.first_name} {lead.last_name}
            </strong>
            {lead.project_type && (
              <> with a <strong>{lead.project_type}</strong> template</>
            )}
            . You can build out the estimate and convert to a project later.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? "Creating..." : "Create Estimate"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
