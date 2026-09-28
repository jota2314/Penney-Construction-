"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Search } from "lucide-react";
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
import { checkOutItem, setWarehouseItemBarcode } from "@/lib/actions/warehouse";
import type { WarehouseEmployee } from "@/lib/actions/warehouse";
import { formatQty, matchScanCode } from "@/lib/warehouse/checkouts";
import { ItemThumb } from "./item-photo";
import { ScanCodeButton } from "./scan-code-button";
import type { WarehouseItem } from "@/types/database";

export type PickableItem = Pick<
  WarehouseItem,
  "id" | "name" | "sku" | "unit" | "quantity_on_hand" | "location" | "barcode"
>;

interface CheckOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Catalog to pick from. With a fixed item (item page) pass just that one. */
  items: PickableItem[];
  /** Pre-selected item. When set the item can't be changed. */
  fixedItemId?: string;
  projects: { id: string; name: string; project_number: string }[];
  employees: WarehouseEmployee[];
  thumbUrls?: Record<string, string>;
}

/**
 * Check Out: item + quantity → job site → who is taking it. Stamped with the
 * time automatically and on-hand drops immediately (warehouse_check_out).
 * From the dashboard the dialog stays open after each checkout, keeping the
 * job and person, so a pile of things going to one crew is quick to log.
 */
export function CheckOutDialog({
  open,
  onOpenChange,
  items,
  fixedItemId,
  projects,
  employees,
  thumbUrls,
}: CheckOutDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [itemId, setItemId] = useState<string | null>(fixedItemId ?? null);
  const [search, setSearch] = useState("");
  const [unmatchedCode, setUnmatchedCode] = useState<string | null>(null);
  const [barcodeSaved, setBarcodeSaved] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [projectId, setProjectId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const item = items.find((i) => i.id === itemId) ?? null;

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.sku.toLowerCase().includes(q) ||
          (i.location ?? "").toLowerCase().includes(q) ||
          (i.barcode ?? "").toLowerCase() === q
      )
      .slice(0, 8);
  }, [items, search]);

  const pickItem = (id: string) => {
    setItemId(id);
    setSearch("");
    setError(null);
    setDone(null);
  };

  const handleCode = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const hit = matchScanCode(items, code);
    if (hit) {
      setUnmatchedCode(null);
      pickItem(hit.id);
      return;
    }
    if (matches.length === 1) {
      pickItem(matches[0].id);
      return;
    }
    if (/^\S{4,}$/.test(code)) {
      setUnmatchedCode(code);
      setSearch("");
    }
  };

  const saveBarcode = () => {
    if (!item || !unmatchedCode) return;
    startTransition(async () => {
      const result = await setWarehouseItemBarcode(item.id, unmatchedCode);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBarcodeSaved(unmatchedCode);
      setUnmatchedCode(null);
    });
  };

  const handleSubmit = () => {
    setError(null);
    setDone(null);
    if (!item) return setError("Pick the item");
    const amount = parseFloat(qty);
    if (!amount || amount <= 0) return setError("Enter a quantity greater than zero");
    if (amount > item.quantity_on_hand) {
      return setError(
        `Only ${formatQty(item.quantity_on_hand)} ${item.unit} on hand`
      );
    }
    if (!projectId) return setError("Pick the job site it is going to");
    if (!employeeId) return setError("Pick who is taking it");

    startTransition(async () => {
      const result = await checkOutItem({
        itemId: item.id,
        quantity: amount,
        projectId,
        employeeId,
        notes: notes.trim() || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      if (fixedItemId) {
        onOpenChange(false);
        return;
      }
      const person = employees.find((e) => e.id === employeeId)?.name ?? "";
      const job = projects.find((p) => p.id === projectId)?.name ?? "";
      setDone(`${formatQty(amount)} ${item.unit} of ${item.name} out to ${person} · ${job}`);
      setItemId(null);
      setQty("1");
      setNotes("");
      setBarcodeSaved(null);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check Out</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {done && (
            <p className="flex items-start gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Checked out: {done}</span>
            </p>
          )}

          {/* Item */}
          <div className="grid gap-1.5">
            <Label>Item</Label>
            {item ? (
              <div className="flex items-center gap-3 rounded-md border border-border p-2">
                <ItemThumb url={thumbUrls?.[item.id]} name={item.name} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.sku}
                    {item.location && <> · {item.location}</>} ·{" "}
                    {formatQty(item.quantity_on_hand)} {item.unit} on hand
                  </p>
                </div>
                {!fixedItemId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setItemId(null)}
                  >
                    Change
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCode(search);
                        }
                      }}
                      placeholder="Search or scan: name, SKU, barcode"
                      className="pl-9"
                      autoFocus
                    />
                  </div>
                  <ScanCodeButton onCode={handleCode} />
                </div>
                {matches.length > 0 && (
                  <div className="flex max-h-64 flex-col overflow-y-auto rounded-md border border-border">
                    {matches.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => pickItem(m.id)}
                        className="flex items-center gap-3 border-b border-border/50 p-2 text-left last:border-b-0 hover:bg-muted/50"
                      >
                        <ItemThumb url={thumbUrls?.[m.id]} name={m.name} className="h-9 w-9" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{m.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.sku}
                            {m.location && <> · {m.location}</>}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatQty(m.quantity_on_hand)} {m.unit}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {unmatchedCode && (
              <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                No item has barcode <span className="font-mono">{unmatchedCode}</span>.
                {item ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="ml-2 h-7"
                    onClick={saveBarcode}
                    disabled={pending}
                  >
                    Save it to this item
                  </Button>
                ) : (
                  <> Pick the item and you can save the barcode to it.</>
                )}
              </div>
            )}
            {barcodeSaved && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                Barcode {barcodeSaved} saved. Next scan finds this item.
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="co-qty">Quantity{item ? ` (${item.unit})` : ""}</Label>
            <Input
              id="co-qty"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Job site</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Where is it going?" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Taken by</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger>
                <SelectValue placeholder="Who is taking it?" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="co-notes">Notes</Label>
            <Textarea
              id="co-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Date and time are stamped automatically.
          </p>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {done ? "Done" : "Cancel"}
            </Button>
            <Button onClick={handleSubmit} disabled={pending || !item}>
              {pending ? "Saving..." : "Check Out"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
