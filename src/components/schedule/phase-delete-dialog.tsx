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
import { deleteSchedulePhase } from "@/lib/actions/schedule";
import type { SchedulePhase } from "@/types/database";

interface PhaseDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phase: SchedulePhase;
}

export function PhaseDeleteDialog({
  open,
  onOpenChange,
  phase,
}: PhaseDeleteDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);

    const result = await deleteSchedulePhase(phase.id, phase.project_id || "");

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
          <DialogTitle>Delete Phase</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete the phase{" "}
            <strong>{phase.name}</strong>? This action cannot be undone.
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
