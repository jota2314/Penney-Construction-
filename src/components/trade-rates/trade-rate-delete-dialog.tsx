"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { deleteTradeRate } from "@/lib/actions/trade-rates";
import type { TradeRate } from "@/types/database";

interface TradeRateDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rate: TradeRate;
  onSuccess: () => void;
}

export function TradeRateDeleteDialog({
  open,
  onOpenChange,
  rate,
  onSuccess,
}: TradeRateDeleteDialogProps) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteTradeRate(rate.id);
    setDeleting(false);
    if (!result.error) onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Trade Rate</DialogTitle>
          <DialogDescription>
            Remove &ldquo;{rate.trade_name}&rdquo; from the cost book? This
            won&apos;t affect existing estimates.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
