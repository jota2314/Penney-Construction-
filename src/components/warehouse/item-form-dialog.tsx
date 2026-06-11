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
import { WAREHOUSE_CATEGORIES, WAREHOUSE_UNITS } from "@/lib/constants/warehouse";
import {
  createWarehouseItem,
  updateWarehouseItem,
} from "@/lib/actions/warehouse";
import type { WarehouseItem } from "@/types/database";

interface ItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this item instead of creating a new one */
  item?: WarehouseItem | null;
}

export function ItemFormDialog({ open, onOpenChange, item }: ItemFormDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "other");
  const [unit, setUnit] = useState(item?.unit ?? "each");
  const [description, setDescription] = useState(item?.description ?? "");
  const [location, setLocation] = useState(item?.location ?? "");
  const [vendor, setVendor] = useState(item?.vendor ?? "");
  const [unitCost, setUnitCost] = useState(item?.unit_cost?.toString() ?? "");
  const [reorderPoint, setReorderPoint] = useState(
    item?.reorder_point?.toString() ?? "0"
  );
  const [reorderQty, setReorderQty] = useState(
    item?.reorder_quantity?.toString() ?? ""
  );
  const [initialQty, setInitialQty] = useState("");

  const isEdit = !!item;

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const input = {
        name,
        category,
        unit,
        description: description.trim() || null,
        location: location.trim() || null,
        vendor: vendor.trim() || null,
        unit_cost: unitCost ? parseFloat(unitCost) : null,
        reorder_point: reorderPoint ? parseFloat(reorderPoint) : 0,
        reorder_quantity: reorderQty ? parseFloat(reorderQty) : null,
      };
      const result = isEdit
        ? await updateWarehouseItem(item.id, input)
        : await createWarehouseItem({
            ...input,
            initial_quantity: initialQty ? parseFloat(initialQty) : 0,
          });
      if (result.error) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Item" : "Add Inventory Item"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="wh-name">Name *</Label>
            <Input
              id="wh-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. 2x4x8 KD Stud, 3" Deck Screws'
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WAREHOUSE_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Unit</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WAREHOUSE_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isEdit && (
            <div className="grid gap-1.5">
              <Label htmlFor="wh-initial">Quantity on hand right now</Label>
              <Input
                id="wh-initial"
                type="number"
                min="0"
                inputMode="decimal"
                value={initialQty}
                onChange={(e) => setInitialQty(e.target.value)}
                placeholder="0"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="wh-reorder-point">Low stock alert at</Label>
              <Input
                id="wh-reorder-point"
                type="number"
                min="0"
                inputMode="decimal"
                value={reorderPoint}
                onChange={(e) => setReorderPoint(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wh-reorder-qty">Reorder quantity</Label>
              <Input
                id="wh-reorder-qty"
                type="number"
                min="0"
                inputMode="decimal"
                value={reorderQty}
                onChange={(e) => setReorderQty(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="wh-location">Warehouse location</Label>
              <Input
                id="wh-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Aisle 2, Bin C"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wh-cost">Unit cost ($)</Label>
              <Input
                id="wh-cost"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="wh-vendor">Vendor / supplier</Label>
            <Input
              id="wh-vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. Moynihan Lumber"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="wh-desc">Description</Label>
            <Textarea
              id="wh-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional details"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={pending || !name.trim()}>
              {pending ? "Saving..." : isEdit ? "Save Changes" : "Add Item"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
