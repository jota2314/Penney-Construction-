"use client";

import { useCallback, useEffect, useState } from "react";
import { getPhaseFinancials, type PhaseFinancials } from "@/lib/actions/phase-financials";
import {
  suggestLineItemsForPhase,
  linkPhaseToLineItem,
  type LineSuggestion,
} from "@/lib/actions/phase-line-link";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
} from "@/components/ui/bottom-sheet";
import { Receipt, HardHat, TrendingUp, TrendingDown, Loader2, Sparkles, Check } from "lucide-react";

interface PhaseDetailPanelProps {
  phaseId: string;
}

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);

export function PhaseDetailPanel({ phaseId }: PhaseDetailPanelProps) {
  const [data, setData] = useState<PhaseFinancials | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkSheetOpen, setLinkSheetOpen] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    getPhaseFinancials(phaseId).then((result) => {
      setData(result);
      setLoading(false);
    });
  }, [phaseId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 justify-center text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading financials...
      </div>
    );
  }

  if (!data) return null;

  const hasBudget = !!data.budget;
  const hasInvoices = data.invoices.length > 0;
  const hasLabor = data.labor.length > 0;
  const hasAnyData = hasBudget || hasInvoices || hasLabor;

  if (!hasAnyData) {
    return (
      <>
        <div className="flex flex-col items-center gap-2 py-3">
          <div className="text-xs text-muted-foreground/60 italic text-center">
            No budget line linked.
          </div>
          <button
            onClick={() => setLinkSheetOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600/15 text-amber-500 hover:bg-amber-600/25 transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Suggest with AI
          </button>
        </div>
        <LinkLineItemSheet
          open={linkSheetOpen}
          onOpenChange={setLinkSheetOpen}
          phaseId={phaseId}
          onLinked={reload}
        />
      </>
    );
  }

  const overBudget = data.budgetRemaining < 0;

  return (
    <div className="space-y-3 pt-1">
      {/* Budget summary bar */}
      {hasBudget && (
        <div className="grid grid-cols-3 gap-2">
          <MiniCard label="Budget" value={fmt(data.budget!.budgeted_cost)} color="text-foreground" />
          <MiniCard label="Spent" value={fmt(data.totalSpent)} color="text-red-400" />
          <MiniCard
            label={overBudget ? "Over" : "Remaining"}
            value={fmt(Math.abs(data.budgetRemaining))}
            color={overBudget ? "text-red-500" : "text-green-500"}
            icon={overBudget ? TrendingDown : TrendingUp}
          />
        </div>
      )}

      {/* Budget progress bar */}
      {hasBudget && data.budget!.budgeted_cost > 0 && (
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${overBudget ? "bg-red-500" : "bg-green-500"}`}
              style={{
                width: `${Math.min(100, (data.totalSpent / data.budget!.budgeted_cost) * 100)}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{Math.round((data.totalSpent / data.budget!.budgeted_cost) * 100)}% spent</span>
            <span>Client price: {fmt(data.budget!.client_price)}</span>
          </div>
        </div>
      )}

      {/* Invoices (sub costs) */}
      {hasInvoices && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            <Receipt className="h-3 w-3" />
            Invoices
            <span className="ml-auto text-red-400 normal-case text-xs font-bold">{fmt(data.totalInvoiced)}</span>
          </div>
          {data.invoices.map((inv) => (
            <div key={inv.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-muted/30">
              <span className="flex-1 font-medium truncate">{inv.vendor_name}</span>
              {inv.invoice_number && (
                <span className="text-muted-foreground">#{inv.invoice_number}</span>
              )}
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                  inv.payment_status === "paid"
                    ? "bg-green-500/15 text-green-500"
                    : "bg-red-500/15 text-red-500"
                }`}
              >
                {inv.payment_status === "paid" ? "Paid" : "Unpaid"}
              </span>
              <span className="font-semibold text-red-400 tabular-nums">{fmt(inv.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Labor (crew hours) */}
      {hasLabor && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            <HardHat className="h-3 w-3" />
            Labor
            <span className="ml-auto text-red-400 normal-case text-xs font-bold">{fmt(data.totalLabor)}</span>
          </div>
          {data.labor.map((l) => (
            <div key={l.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-muted/30">
              <span className="flex-1 font-medium">{l.employee_name}</span>
              <span className="text-muted-foreground">
                {l.hours}h @ ${l.hourly_rate}/hr
              </span>
              <span className="font-semibold text-red-400 tabular-nums">{fmt(l.cost)}</span>
            </div>
          ))}
        </div>
      )}

      {/* No invoices or labor yet but has budget */}
      {hasBudget && !hasInvoices && !hasLabor && (
        <div className="text-xs text-muted-foreground/50 text-center py-2 italic">
          No expenses recorded yet for this phase.
        </div>
      )}
    </div>
  );
}

function LinkLineItemSheet({
  open,
  onOpenChange,
  phaseId,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  phaseId: string;
  onLinked: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<LineSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    suggestLineItemsForPhase(phaseId).then((res) => {
      setSuggestions(res.suggestions);
      setError(res.error ?? null);
      setLoading(false);
    });
  }, [open, phaseId]);

  const handleLink = async (lineId: string) => {
    setLinkingId(lineId);
    const res = await linkPhaseToLineItem(phaseId, lineId);
    setLinkingId(null);
    if (res.ok) {
      onOpenChange(false);
      onLinked();
    } else {
      setError(res.error ?? "Failed to link");
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="max-h-[70vh] flex flex-col">
        <BottomSheetHeader>
          <BottomSheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-amber-500" />
            AI-suggested budget lines
          </BottomSheetTitle>
        </BottomSheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Asking the AI…
            </div>
          )}
          {!loading && error && (
            <div className="py-6 text-sm text-red-500 text-center">{error}</div>
          )}
          {!loading && !error && suggestions.length === 0 && (
            <div className="py-6 text-sm text-muted-foreground text-center italic">
              No matching budget lines found.
            </div>
          )}
          {!loading && !error && suggestions.length > 0 && (
            <ul className="flex flex-col gap-2">
              {suggestions.map((s, idx) => {
                const isLinking = linkingId === s.id;
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => handleLink(s.id)}
                      disabled={!!linkingId}
                      className="w-full text-left rounded-xl p-3 border border-border bg-muted/30 hover:bg-muted/50 transition-colors disabled:opacity-50 flex items-start gap-3"
                    >
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-600/20 text-amber-500 text-[11px] font-bold flex items-center justify-center mt-0.5">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold truncate">{s.description}</span>
                          {s.trade && (
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 flex-shrink-0">
                              {s.trade}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground/80 mt-0.5">{s.reason}</div>
                        {s.total_cost != null && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Budget: ${Math.round(s.total_cost).toLocaleString()}
                          </div>
                        )}
                      </div>
                      {isLinking ? (
                        <Loader2 className="h-4 w-4 animate-spin text-amber-500 flex-shrink-0" />
                      ) : (
                        <Check className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}

function MiniCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  color: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg bg-muted/30 p-2 text-center">
      <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-bold flex items-center justify-center gap-0.5 ${color}`}>
        {Icon && <Icon className="h-3 w-3" />}
        {value}
      </div>
    </div>
  );
}
