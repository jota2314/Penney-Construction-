"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { WorkflowDeleteDialog } from "./workflow-delete-dialog";

interface WorkflowDetailActionsProps {
  workflowId: string;
  projectName: string;
  clientName: string;
}

export function WorkflowDetailActions({
  workflowId,
  projectName,
  clientName,
}: WorkflowDetailActionsProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="text-destructive hover:text-destructive"
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <WorkflowDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        workflowId={workflowId}
        projectName={projectName}
        clientName={clientName}
        redirectOnDelete
      />
    </>
  );
}
