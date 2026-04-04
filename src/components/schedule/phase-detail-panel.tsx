"use client";

import { useEffect, useState } from "react";
import { getPhaseFinancials, type PhaseFinancials } from "@/lib/actions/phase-financials";
import { Receipt, HardHat, TrendingUp, TrendingDown, DollarSign, Loader2 } from "lucide-react";

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

  useEffect(() => {
    setLoading(true);
    getPhaseFinancials(phaseId).then((result) => {
      setData(result);
      setLoading(false);
    });
  }, [phaseId]);

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
      <div className="text-xs text-muted-foreground/50 py-3 text-center italic">
        No budget line linked. Connect this phase to an estimate line to track costs.
      </div>
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
