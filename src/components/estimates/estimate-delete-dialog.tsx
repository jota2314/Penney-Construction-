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
import { deleteEstimate } from "@/lib/actions/estimates";
import type { Estimate } from "@/types/database";

interface EstimateDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimate: Estimate;
  projectId: string;
  redirectOnDelete?: boolean;
}

export function EstimateDeleteDialog({
  open,
  onOpenChange,
  estimate,
  projectId,
  redirectOnDelete,
}: EstimateDeleteDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDelete() {
    setLoading(true);
    setError(null);

    const result = await deleteEstimate(estimate.id, projectId);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
      if (redirectOnDelete) {
        router.push(`/projects/${projectId}`);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Delete Estimate</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete{" "}
            <strong>{estimate.name}</strong> (v{estimate.version})? This
            action cannot be undone and will remove all line items.
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
