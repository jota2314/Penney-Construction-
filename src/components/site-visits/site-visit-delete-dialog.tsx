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
import { deleteSiteVisit } from "@/lib/actions/site-visits";
import type { SiteVisit } from "@/types/database";

interface SiteVisitDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteVisit: SiteVisit;
  redirectOnDelete?: boolean;
}

export function SiteVisitDeleteDialog({
  open,
  onOpenChange,
  siteVisit,
  redirectOnDelete,
}: SiteVisitDeleteDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDelete() {
    setLoading(true);
    setError(null);

    const result = await deleteSiteVisit(siteVisit.id);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
      if (redirectOnDelete) {
        router.push("/site-visits");
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Delete Site Visit</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this site visit? All notes, photos, and
            the summary will be permanently removed.
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
