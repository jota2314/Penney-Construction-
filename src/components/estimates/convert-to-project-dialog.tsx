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
import { convertLeadToProject } from "@/lib/actions/leads";

interface ConvertToProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  estimateId: string;
  clientName: string;
}

export function ConvertToProjectDialog({
  open,
  onOpenChange,
  leadId,
  estimateId,
  clientName,
}: ConvertToProjectDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConvert() {
    setLoading(true);
    setError(null);

    const result = await convertLeadToProject(leadId, estimateId);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
      if (result.projectId) {
        router.push(`/projects/${result.projectId}`);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Convert to Project</DialogTitle>
          <DialogDescription>
            This will create a Customer and Project from{" "}
            <strong>{clientName}</strong>&apos;s lead information and link this
            estimate to the new project.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConvert} disabled={loading}>
            {loading ? "Converting..." : "Convert to Project"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
