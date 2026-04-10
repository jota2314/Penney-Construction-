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
import { UNIT_TYPE_LABELS, UNIT_TYPE_OPTIONS, TRADE_CATEGORIES } from "@/lib/constants/trade-rate";
import type { TradeRate, UnitType, ProjectType } from "@/types/database";

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
  const [unitType, setUnitType] = useState<UnitType>(rate?.unit_type as UnitType ?? "each");
  const [tradeCategory, setTradeCategory] = useState(rate?.trade_category ?? "");
  const [subcategory, setSubcategory] = useState(rate?.subcategory ?? "");
  const [avgCost, setAvgCost] = useState(rate?.avg_cost?.toString() ?? "");
  const [avgPrice, setAvgPrice] = useState(rate?.avg_price?.toString() ?? "");
  const [minPrice, setMinPrice] = useState(rate?.min_price?.toString() ?? "");
  const [maxPrice, setMaxPrice] = useState(rate?.max_price?.toString() ?? "");
  const [scopeIncludes, setScopeIncludes] = useState(rate?.scope_includes ?? "");
  const [notes, setNotes] = useState(rate?.notes ?? "");
  const [projectType, setProjectType] = useState<string>(
    rate?.project_type ?? defaultProjectType ?? "general"
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
      trade_category: tradeCategory || null,
      subcategory: subcategory || null,
      avg_cost: parseFloat(avgCost) || 0,
      avg_price: parseFloat(avgPrice) || 0,
      min_cost: parseFloat(avgCost) ? parseFloat(avgCost) * 0.8 : null,
      max_cost: parseFloat(avgCost) ? parseFloat(avgCost) * 1.3 : null,
      min_price: parseFloat(minPrice) || null,
      max_price: parseFloat(maxPrice) || null,
      scope_includes: scopeIncludes || null,
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
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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
                placeholder="e.g. Full Bath Remodel Plumbing"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Trade Category</Label>
                <Select value={tradeCategory} onValueChange={setTradeCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {TRADE_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Subcategory</Label>
                <Input
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  placeholder="e.g. Per Room, Per Item"
                />
              </div>
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
                <Select value={projectType} onValueChange={setProjectType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General (All)</SelectItem>
                    <SelectItem value="bathroom">Bathroom</SelectItem>
                    <SelectItem value="kitchen">Kitchen</SelectItem>
                    <SelectItem value="remodel">Remodel</SelectItem>
                    <SelectItem value="addition">Addition</SelectItem>
                    <SelectItem value="new_construction">New Construction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Pricing (Client Sell Price)</Label>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">Low</div>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">Mid</div>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={avgPrice}
                    onChange={(e) => setAvgPrice(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">High</div>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Our Cost (Mid)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={avgCost}
                onChange={(e) => setAvgCost(e.target.value)}
                placeholder="Sell ÷ 1.30"
              />
              {costNum > 0 && priceNum > 0 && (
                <div className="text-xs text-muted-foreground">
                  Markup: {markupPct}%
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Scope — What&apos;s Included</Label>
              <Textarea
                value={scopeIncludes}
                onChange={(e) => setScopeIncludes(e.target.value)}
                placeholder="Describe what this price covers..."
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal notes..."
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
