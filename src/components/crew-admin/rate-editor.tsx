"use client";

import { useCallback, useState, useTransition } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  DollarSign,
  History,
  Loader2,
  Lock,
  Pencil,
  Wrench,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listEmployeeRateHistory,
  setEmployeeHourlyRate,
  type RateChange,
} from "@/lib/actions/employee-rates";

type ChangeKind = "raise" | "decrease" | "correction";

function fmtRate(rate: number | null | undefined): string {
  return rate == null ? "—" : `$${Number(rate).toFixed(2)}`;
}

function fmtDate(d: string): string {
  return new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* --------------------------------- trigger -------------------------------- */

/**
 * Tappable pay-rate chip. Read-only (plain text) unless `canEdit`, so the same
 * chip renders for viewers who may see a rate but not change it.
 */
export function RateChip({
  employeeId,
  name,
  rate,
  canEdit,
  rateHidden = false,
  onChanged,
  className = "",
}: {
  employeeId: string;
  name: string;
  rate: number | null;
  canEdit: boolean;
  /** Rate exists but is masked for this viewer — show as hidden, never editable. */
  rateHidden?: boolean;
  onChanged?: (newRate: number | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const label = rateHidden
    ? "Rate hidden"
    : rate == null
      ? "No rate"
      : `${fmtRate(rate)}/hr`;
  const base =
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums whitespace-nowrap";
  const tone =
    rateHidden
      ? "bg-muted text-muted-foreground/70"
      : rate == null
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        : "bg-muted text-muted-foreground";

  if (!canEdit || rateHidden) {
    return (
      <span className={`${base} ${tone} ${className}`}>
        {rateHidden && <Lock className="h-2.5 w-2.5 opacity-60" />}
        {label}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${base} ${tone} ${className} hover:bg-amber-500/20 hover:text-amber-600 dark:hover:text-amber-400 transition-colors`}
        aria-label={`Edit hourly rate for ${name}`}
      >
        {label}
        <Pencil className="h-2.5 w-2.5 opacity-60" />
      </button>
      <RateEditorDialog
        open={open}
        onOpenChange={setOpen}
        employeeId={employeeId}
        name={name}
        rate={rate}
        onChanged={onChanged}
      />
    </>
  );
}

/* --------------------------------- dialog --------------------------------- */

export function RateEditorDialog({
  open,
  onOpenChange,
  employeeId,
  name,
  rate,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  name: string;
  rate: number | null;
  onChanged?: (newRate: number | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] max-h-[92vh] overflow-y-auto">
        {/* Mounted only while open, so every open starts from a clean form
            without an effect resetting state. */}
        {open && (
          <RateForm
            employeeId={employeeId}
            name={name}
            rate={rate}
            onChanged={onChanged}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RateForm({
  employeeId,
  name,
  rate,
  onChanged,
  onClose,
}: {
  employeeId: string;
  name: string;
  rate: number | null;
  onChanged?: (newRate: number | null) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(rate == null ? "" : String(rate));
  const [kind, setKind] = useState<ChangeKind>("raise");
  const [effectiveDate, setEffectiveDate] = useState(todayLocal);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RateChange[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [saving, startSave] = useTransition();

  const loadHistory = useCallback(() => {
    setShowHistory(true);
    if (history) return;
    listEmployeeRateHistory(employeeId).then((res) => {
      if (res.data) setHistory(res.data);
    });
  }, [employeeId, history]);

  const parsed = value.trim() === "" ? null : Number(value);
  const invalid = parsed != null && (!Number.isFinite(parsed) || parsed < 0);
  const unchanged = parsed === rate || (parsed == null && rate == null);

  const save = () => {
    setError(null);
    startSave(async () => {
      const res = await setEmployeeHourlyRate(employeeId, parsed, {
        kind,
        effectiveDate,
        reason,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setHistory(null);
      onChanged?.(res.newRate ?? null);
      onClose();
    });
  };

  const delta = parsed != null && rate != null ? parsed - rate : null;

  return (
    <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-amber-500" />
            Pay rate — {name}
          </DialogTitle>
          <DialogDescription>
            Currently {rate == null ? "no rate set" : `${fmtRate(rate)}/hr`}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="rate-value">New hourly rate</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                id="rate-value"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="45.00"
                className="pl-7 text-lg tabular-nums"
                autoFocus
              />
            </div>
            {delta != null && delta !== 0 && (
              <p
                className={`mt-1 flex items-center gap-1 text-xs ${delta > 0 ? "text-green-500" : "text-red-400"}`}
              >
                {delta > 0 ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                {delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}/hr
              </p>
            )}
          </div>

          {/* Change type */}
          <div>
            <Label>Type of change</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <KindButton
                active={kind !== "correction"}
                onClick={() => setKind(delta != null && delta < 0 ? "decrease" : "raise")}
                icon={<ArrowUpRight className="h-3.5 w-3.5" />}
                label="Raise / change"
                hint="Pay changes going forward"
              />
              <KindButton
                active={kind === "correction"}
                onClick={() => setKind("correction")}
                icon={<Wrench className="h-3.5 w-3.5" />}
                label="Correction"
                hint="The old rate was wrong"
              />
            </div>
          </div>

          {/* Retroactive warning — cost is always computed from the live rate. */}
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
            {kind === "correction" ? (
              <>
                All past hours will re-cost at the new rate — which is what you
                want when the old number was simply wrong.
              </>
            ) : (
              <>
                Heads up: labor cost is calculated from the current rate, so
                already-worked hours will re-cost at the new rate too. Log the
                raise on the day it takes effect and pull any payroll report you
                need first.
              </>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rate-date">Effective date</Label>
              <Input
                id="rate-date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="rate-reason">Note (optional)</Label>
              <Input
                id="rate-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Annual review"
                className="mt-1"
              />
            </div>
          </div>

          {error && (
            <p className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          {/* History */}
          <div>
            {!showHistory ? (
              <button
                type="button"
                onClick={loadHistory}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <History className="h-3.5 w-3.5" />
                Rate history
              </button>
            ) : (
              <div className="rounded-lg border border-border/60 divide-y divide-border/60">
                {history == null ? (
                  <div className="flex items-center justify-center py-4 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : history.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-muted-foreground">
                    No recorded changes yet.
                  </p>
                ) : (
                  history.map((h) => (
                    <div key={h.id} className="px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-medium tabular-nums">
                          {h.previousRate != null && `${fmtRate(h.previousRate)} → `}
                          {fmtRate(h.newRate)}
                        </span>
                        <span className="text-[10px] uppercase font-semibold text-muted-foreground shrink-0">
                          {h.kind}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {fmtDate(h.effectiveDate)}
                        {h.changedByName && ` · ${h.changedByName}`}
                      </p>
                      {h.reason && (
                        <p className="text-[10px] text-muted-foreground italic mt-0.5">
                          {h.reason}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || invalid || unchanged}>
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Save rate
          </Button>
        </DialogFooter>
    </>
  );
}

function KindButton({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
        active
          ? "border-amber-500/50 bg-amber-500/10"
          : "border-border hover:bg-muted/50"
      }`}
    >
      <span
        className={`flex items-center gap-1.5 text-xs font-medium ${active ? "text-amber-600 dark:text-amber-400" : ""}`}
      >
        {icon}
        {label}
      </span>
      <span className="block text-[10px] text-muted-foreground mt-0.5">{hint}</span>
    </button>
  );
}
