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
import { deleteWorkflow } from "@/lib/actions/workflow";

interface WorkflowDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  projectName: string;
  clientName: string;
  redirectOnDelete?: boolean;
}

export function WorkflowDeleteDialog({
  open,
  onOpenChange,
  workflowId,
  projectName,
  clientName,
  redirectOnDelete,
}: WorkflowDeleteDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDelete() {
    setLoading(true);
    setError(null);

    const result = await deleteWorkflow(workflowId);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
      if (redirectOnDelete) {
        router.push("/workflow");
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Delete Workflow</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete the workflow for{" "}
            <strong>{clientName} - {projectName}</strong>? This
            action cannot be undone and will remove all activity logs.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
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
