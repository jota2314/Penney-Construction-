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
import { checkInItem } from "@/lib/actions/warehouse";
import type { WarehouseEmployee } from "@/lib/actions/warehouse";
import {
  daysOut,
  daysOutLabel,
  formatQty,
  formatShopDate,
  matchScanCode,
} from "@/lib/warehouse/checkouts";
import { ItemThumb } from "./item-photo";
import { ScanCodeButton } from "./scan-code-button";
import type { WarehouseOpenCheckout } from "@/types/database";

/** Whoever took it usually brings it back — preselect them when they're on the list. */
function defaultReturner(
  c: WarehouseOpenCheckout | null,
  employees: WarehouseEmployee[]
): string {
  if (!c?.employee_id) return "";
  return employees.some((e) => e.id === c.employee_id) ? c.employee_id : "";
}

interface CheckInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is currently out (warehouse_open_checkouts). */
  checkouts: WarehouseOpenCheckout[];
  employees: WarehouseEmployee[];
  /** Jump straight to one checkout (Check in button on a row). */
  initialCheckoutId?: string;
  /** Only offer this item's checkouts (item page). */
  itemId?: string;
  thumbUrls?: Record<string, string>;
}

/**
 * Check In: pick from what's out → who brought it back → how many (partial
 * returns allowed). Time-stamped automatically; on-hand goes back up and the
 * return row is linked to its checkout (warehouse_check_in).
 */
export function CheckInDialog({
  open,
  onOpenChange,
  checkouts,
  employees,
  initialCheckoutId,
  itemId,
  thumbUrls,
}: CheckInDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Opened from a row: start on that checkout, returned-by defaulting to the
  // person who took it. Parents key this dialog per checkout.
  const initial = initialCheckoutId
    ? (checkouts.find((c) => c.id === initialCheckoutId) ?? null)
    : null;
  const [search, setSearch] = useState("");
  const [scanItemId, setScanItemId] = useState<string | null>(null);
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initial?.id ?? null);
  const [employeeId, setEmployeeId] = useState(() =>
    defaultReturner(initial, employees)
  );
  const [qty, setQty] = useState(() =>
    initial ? formatQty(initial.quantity_outstanding) : ""
  );
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const pool = useMemo(
    () => (itemId ? checkouts.filter((c) => c.item_id === itemId) : checkouts),
    [checkouts, itemId]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pool.filter((c) => {
      if (scanItemId && c.item_id !== scanItemId) return false;
      if (!q) return true;
      return (
        c.item_name.toLowerCase().includes(q) ||
        c.sku.toLowerCase().includes(q) ||
        (c.project_name ?? "").toLowerCase().includes(q) ||
        (c.employee_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [pool, search, scanItemId]);

  const selected = pool.find((c) => c.id === selectedId) ?? null;

  const select = (c: WarehouseOpenCheckout) => {
    setSelectedId(c.id);
    setError(null);
    setDone(null);
    setQty(formatQty(c.quantity_outstanding));
    setEmployeeId(defaultReturner(c, employees));
  };

  const handleCode = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const hit = matchScanCode(pool, code);
    if (!hit) {
      if (/^\S{4,}$/.test(code) && visible.length === 0) setScanMiss(code);
      return;
    }
    setScanMiss(null);
    setSearch("");
    const forItem = pool.filter((c) => c.item_id === hit.item_id);
    if (forItem.length === 1) select(forItem[0]);
    else setScanItemId(hit.item_id);
  };

  const handleSubmit = () => {
    setError(null);
    if (!selected) return setError("Pick what is coming back");
    const amount = parseFloat(qty);
    if (!amount || amount <= 0) return setError("Enter a quantity greater than zero");
    if (amount > selected.quantity_outstanding) {
      return setError(
        `Only ${formatQty(selected.quantity_outstanding)} ${selected.unit} still out on this checkout`
      );
    }
    if (!employeeId) return setError("Pick who returned it");

    startTransition(async () => {
      const result = await checkInItem({
        checkoutId: selected.id,
        quantity: amount,
        employeeId,
        notes: notes.trim() || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      if (initialCheckoutId) {
        onOpenChange(false);
        return;
      }
      const left = result.stillOut ?? 0;
      setDone(
        `${formatQty(amount)} ${selected.unit} of ${selected.item_name}` +
          (left > 0 ? ` (${formatQty(left)} still out)` : "")
      );
      setSelectedId(null);
      setScanItemId(null);
      setQty("");
      setNotes("");
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check In</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {done && (
            <p className="flex items-start gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Checked in: {done}</span>
            </p>
          )}

          {selected ? (
            <div className="flex items-center gap-3 rounded-md border border-border p-2">
              <ItemThumb
                url={thumbUrls?.[selected.item_id]}
                name={selected.item_name}
                className="h-10 w-10"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{selected.item_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatQty(selected.quantity_outstanding)} of{" "}
                  {formatQty(selected.quantity_out)} {selected.unit} out ·{" "}
                  {selected.project_name ?? "No job"} · {selected.employee_name ?? "Unknown"} ·{" "}
                  {formatShopDate(selected.checked_out_at)}
                </p>
              </div>
              {!initialCheckoutId && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                  Change
                </Button>
              )}
            </div>
          ) : pool.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Nothing is checked out right now.
            </p>
          ) : (
            <div className="grid gap-2">
              <Label>What&apos;s coming back?</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setScanItemId(null);
                      setScanMiss(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleCode(search);
                      }
                    }}
                    placeholder="Search or scan: item, job, person"
                    className="pl-9"
                  />
                </div>
                <ScanCodeButton onCode={handleCode} />
              </div>
              {scanMiss && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Nothing out matches <span className="font-mono">{scanMiss}</span>.
                </p>
              )}
              <div className="flex max-h-72 flex-col overflow-y-auto rounded-md border border-border">
                {visible.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">Nothing matches.</p>
                ) : (
                  visible.map((c) => {
                    const days = daysOut(c.checked_out_at);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => select(c)}
                        className="flex items-center gap-3 border-b border-border/50 p-2 text-left last:border-b-0 hover:bg-muted/50"
                      >
                        <ItemThumb
                          url={thumbUrls?.[c.item_id]}
                          name={c.item_name}
                          className="h-9 w-9"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            {c.item_name}{" "}
                            <span className="text-muted-foreground">
                              × {formatQty(c.quantity_outstanding)}
                            </span>
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {c.project_name ?? "No job"} · {c.employee_name ?? "Unknown"}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {daysOutLabel(days)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {selected && (
            <>
              <div className="grid gap-1.5">
                <Label>Returned by</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Who brought it back?" />
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
                <Label htmlFor="ci-qty">
                  Quantity returned ({selected.unit}, up to{" "}
                  {formatQty(selected.quantity_outstanding)})
                </Label>
                <Input
                  id="ci-qty"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="ci-notes">Notes</Label>
                <Textarea
                  id="ci-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Optional (condition, missing parts...)"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                Date and time are stamped automatically.
              </p>
            </>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {done ? "Done" : "Cancel"}
            </Button>
            <Button onClick={handleSubmit} disabled={pending || !selected}>
              {pending ? "Saving..." : "Check In"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
