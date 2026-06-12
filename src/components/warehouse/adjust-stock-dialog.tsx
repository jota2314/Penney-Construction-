"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adjustStock } from "@/lib/actions/warehouse";
import type { WarehouseItem } from "@/types/database";

type AdjustMode = "receive" | "issue" | "return" | "adjust";

const MODE_LABELS: Record<AdjustMode, string> = {
  receive: "Receive Stock",
  issue: "Issue / Take Out",
  return: "Return to Stock",
  adjust: "Count Adjustment",
};

interface AdjustStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: WarehouseItem;
  initialMode?: AdjustMode;
  projects: { id: string; name: string; project_number: string }[];
}

export function AdjustStockDialog({
  open,
  onOpenChange,
  item,
  initialMode = "receive",
  projects,
}: AdjustStockDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AdjustMode>(initialMode);
  const [qty, setQty] = useState("");
  const [projectId, setProjectId] = useState<string>("none");
  const [notes, setNotes] = useState("");

  const handleSubmit = () => {
    setError(null);
    const amount = parseFloat(qty);
    if (!amount || amount <= 0) {
      setError("Enter a quantity greater than zero");
      return;
    }
    // "adjust" sets the count to the entered number; the others move by it.
    const change =
      mode === "adjust"
        ? amount - item.quantity_on_hand
        : mode === "issue"
          ? -amount
          : amount;
    if (change === 0) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      const result = await adjustStock({
        itemId: item.id,
        change,
        type: mode,
        projectId: projectId === "none" ? null : projectId,
        notes: notes.trim() || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setQty("");
      setNotes("");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            On hand:{" "}
            <span className="font-semibold text-foreground">
              {item.quantity_on_hand} {item.unit}
            </span>
            {item.location && <> · {item.location}</>}
          </p>

          <div className="grid gap-1.5">
            <Label>Action</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as AdjustMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MODE_LABELS) as AdjustMode[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {MODE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="adj-qty">
              {mode === "adjust" ? "New count" : `Quantity (${item.unit})`}
            </Label>
            <Input
              id="adj-qty"
              type="number"
              min="0"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              autoFocus
            />
          </div>

          {(mode === "issue" || mode === "return") && (
            <div className="grid gap-1.5">
              <Label>Project (optional)</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="adj-notes">Notes</Label>
            <Textarea
              id="adj-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={pending}>
              {pending ? "Saving..." : MODE_LABELS[mode]}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
