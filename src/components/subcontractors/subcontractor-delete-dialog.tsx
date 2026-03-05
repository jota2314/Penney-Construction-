"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteSubcontractor } from "@/lib/actions/subcontractors";
import type { Subcontractor } from "@/types/database";

interface SubcontractorDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subcontractor: Subcontractor;
}

export function SubcontractorDeleteDialog({
  open,
  onOpenChange,
  subcontractor,
}: SubcontractorDeleteDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);

    const result = await deleteSubcontractor(subcontractor.id);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Delete Subcontractor</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete{" "}
            <strong>{subcontractor.company_name}</strong>? This action cannot be
            undone.
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
