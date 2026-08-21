"use client";

import { useState, useTransition } from "react";
import { Lock, LockOpen, TrendingUp, TrendingDown, Clock, Receipt } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { closeLineItem, reopenLineItem } from "@/lib/actions/line-closeout";
import type { LineCloseout } from "@/lib/actions/line-closeout";

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(val);

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

interface LineCloseoutSheetProps {
  closeout: LineCloseout | null;
  projectId: string;
  onClose: () => void;
}

export function LineCloseoutSheet({ closeout, projectId, onClose }: LineCloseoutSheetProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!closeout) return null;

  const c = closeout;
  const made = c.margin >= 0;

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      else onClose();
    });
  };

  return (
    <Dialog open={!!closeout} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-6 text-base leading-snug">{c.description}</DialogTitle>
        </DialogHeader>

        {/* ── What we made ── */}
        <div
          className={`rounded-xl border-2 p-5 text-center ${
            made
              ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/15"
              : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-900/15"
          }`}
        >
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {made ? "Made on this line" : "Lost on this line"}
          </div>
          <div
            className={`mt-1 text-4xl font-bold tabular-nums ${
              made ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
            }`}
          >
            {fmt(Math.abs(c.margin))}
          </div>
          <div className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground">
            {made ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {c.marginPct.toFixed(1)}% of {fmt(c.price)}
          </div>
        </div>

        {/* ── The math ── */}
        <div className="rounded-lg border divide-y text-sm">
          <Row label="Client price" value={fmt(c.price)} />
          <Row
            label={
              <span className="inline-flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                Invoices ({c.invoices.length})
              </span>
            }
            value={`− ${fmt(c.invoiceCost)}`}
            muted
          />
          <Row
            label={
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                Crew labor
              </span>
            }
            value={`− ${fmt(c.laborCost)}`}
            muted
          />
          <Row label="Margin" value={fmt(c.margin)} bold />
        </div>

        {/* ── Invoices behind the number ── */}
        {c.invoices.length > 0 && (
          <div className="max-h-44 overflow-auto rounded-lg border divide-y">
            {c.invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-medium">{inv.vendor_name ?? "Unknown vendor"}</div>
                  <div className="text-muted-foreground">
                    {inv.invoice_number ? `#${inv.invoice_number} · ` : ""}
                    {fmtDate(inv.invoice_date)}
                    {inv.payment_status !== "paid" && (
                      <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">unpaid</span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 tabular-nums font-medium">{fmt(inv.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {!c.fullyPaid && !c.isLocked && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/15 dark:text-amber-400">
            {c.invoices.length === 0
              ? "No invoices are coded to this line yet, so this margin is the full client price. Check that cost has actually been booked before closing it."
              : "Not every invoice on this line is marked paid. Closing now locks a margin that could still move."}
          </p>
        )}

        {c.isLocked && c.closedMargin !== null && Math.abs(c.closedMargin - c.margin) > 0.01 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/15 dark:text-amber-400">
            Cost moved after this line was closed. Recorded at close: {fmt(c.closedMargin)}. Live now:{" "}
            {fmt(c.margin)}.
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/15 dark:text-red-400">
            {error}
          </p>
        )}

        {/* ── Lock ── */}
        {c.isLocked ? (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              Closed {fmtDate(c.closedAt)}
              {c.closedByName ? ` by ${c.closedByName}` : ""}
            </div>
            <Button
              variant="outline"
              className="w-full"
              disabled={pending}
              onClick={() => run(() => reopenLineItem(c.lineItemId, projectId))}
            >
              <LockOpen className="mr-2 h-4 w-4" />
              {pending ? "Unlocking…" : "Unlock this line"}
            </Button>
          </div>
        ) : (
          <Button
            className="w-full"
            disabled={pending}
            onClick={() => run(() => closeLineItem(c.lineItemId, projectId))}
          >
            <Lock className="mr-2 h-4 w-4" />
            {pending ? "Closing…" : "Close out & lock"}
          </Button>
        )}

        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          Locking blocks new invoices and labor from being coded to this line, from every route
          including the inbox router and field capture. Price and scope stay editable.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
}: {
  label: React.ReactNode;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className={muted ? "text-muted-foreground" : bold ? "font-semibold" : ""}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-bold" : "font-medium"}`}>{value}</span>
    </div>
  );
}
