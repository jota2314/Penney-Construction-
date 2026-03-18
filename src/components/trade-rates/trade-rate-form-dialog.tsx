"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { createTradeRate, updateTradeRate } from "@/lib/actions/trade-rates";
import { UNIT_TYPE_LABELS, UNIT_TYPE_OPTIONS } from "@/lib/constants/trade-rate";
import { PROJECT_TYPE_LABELS } from "@/lib/constants/project";
import type { TradeRate, UnitType, ProjectType } from "@/types/database";

const PROJECT_TYPE_OPTIONS: (ProjectType | "general")[] = [
  "general",
  "bathroom",
  "kitchen",
  "remodel",
  "addition",
  "new_construction",
];

interface TradeRateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rate?: TradeRate;
  defaultProjectType?: ProjectType | null;
  onSuccess: () => void;
}

export function TradeRateFormDialog({
  open,
  onOpenChange,
  rate,
  defaultProjectType,
  onSuccess,
}: TradeRateFormDialogProps) {
  const isEdit = !!rate;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tradeName, setTradeName] = useState(rate?.trade_name ?? "");
  const [description, setDescription] = useState(rate?.description ?? "");
  const [unitType, setUnitType] = useState<UnitType>(rate?.unit_type as UnitType ?? "sqft");
  const [avgCost, setAvgCost] = useState(rate?.avg_cost?.toString() ?? "");
  const [avgPrice, setAvgPrice] = useState(rate?.avg_price?.toString() ?? "");
  const [notes, setNotes] = useState(rate?.notes ?? "");
  const [projectType, setProjectType] = useState<ProjectType | "general">(
    (rate?.project_type as ProjectType) ?? defaultProjectType ?? "general"
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tradeName.trim()) return;

    setSaving(true);
    setError(null);

    const input = {
      trade_name: tradeName,
      description: description || null,
      unit_type: unitType,
      avg_cost: parseFloat(avgCost) || 0,
      avg_price: parseFloat(avgPrice) || 0,
      notes: notes || null,
      project_type: projectType === "general" ? null : (projectType as ProjectType),
    };

    const result = isEdit
      ? await updateTradeRate(rate.id, input)
      : await createTradeRate(input);

    if (result.error) {
      setError(result.error);
      setSaving(false);
      return;
    }

    setSaving(false);
    onSuccess();
  }

  const costNum = parseFloat(avgCost) || 0;
  const priceNum = parseFloat(avgPrice) || 0;
  const markupPct = costNum > 0 ? (((priceNum - costNum) / costNum) * 100).toFixed(0) : "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Trade Rate" : "Add Trade Rate"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Trade Name *</Label>
              <Input
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                placeholder="e.g. Framing, Tile, Plumbing Rough-In"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this rate covers"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Unit Type</Label>
                <Select value={unitType} onValueChange={(v) => setUnitType(v as UnitType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIT_TYPE_OPTIONS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {UNIT_TYPE_LABELS[u]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Project Type</Label>
                <Select
                  value={projectType}
                  onValueChange={(v) => setProjectType(v as ProjectType | "general")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_TYPE_OPTIONS.map((pt) => (
                      <SelectItem key={pt} value={pt}>
                        {pt === "general" ? "General (All)" : PROJECT_TYPE_LABELS[pt]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Our Cost ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={avgCost}
                  onChange={(e) => setAvgCost(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Our Price ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={avgPrice}
                  onChange={(e) => setAvgPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            {costNum > 0 && priceNum > 0 && (
              <div className="text-xs text-muted-foreground">
                Markup: {markupPct}% ({new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(priceNum - costNum)} margin per unit)
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about this rate..."
                rows={2}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !tradeName.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Save" : "Add Rate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
