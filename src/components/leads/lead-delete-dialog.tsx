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
import { deleteLead } from "@/lib/actions/leads";
import type { Lead } from "@/types/database";

interface LeadDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
  redirectOnDelete?: boolean;
}

export function LeadDeleteDialog({
  open,
  onOpenChange,
  lead,
  redirectOnDelete,
}: LeadDeleteDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDelete() {
    setLoading(true);
    setError(null);

    const result = await deleteLead(lead.id);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
      if (redirectOnDelete) {
        router.push("/crm/leads");
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Delete Lead</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete{" "}
            <strong>
              {lead.first_name} {lead.last_name}
            </strong>{" "}
            ({lead.lead_number})? This will also delete all associated meetings,
            notes, and photos. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={loading}
          >
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
