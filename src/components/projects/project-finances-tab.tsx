"use client";

import { useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  HardHat,
  Wand2,
  Loader2,
  Users,
  Receipt,
  FileWarning,
  ShieldCheck,
  CircleDollarSign,
  Wallet,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { QuoteRequest, Invoice, Estimate } from "@/types/database";

// ── Types ──────────────────────────────────────────────

export interface TimeEntryWithEmployee {
  id: string;
  employee_id: string;
  employee_name: string;
  hourly_rate: number | null;
  clock_in: string;
  clock_out: string | null;
  break_minutes: number;
}

interface PaymentRow {
  id: string;
  payment_type: string;
  amount: number;
  received_date: string;
  method: string | null;
  reference_number: string | null;
  description: string | null;
}

interface ChangeOrderRow {
  id: string;
  change_order_number: number;
  title: string;
  description: string | null;
  status: string;
  cost_impact: number;
  price_impact: number;
  approved_at: string | null;
}

interface BudgetVsActualRow {
  line_item_id: string;
  description: string;
  trade: string | null;
  budgeted_cost: number;
  actual_invoiced: number;
  variance: number;
  percent_spent: number;
}

interface ProjectFinancesTabProps {
  projectId: string;
  estimates: Estimate[];
  quoteRequests: QuoteRequest[];
  invoices: Invoice[];
  paymentsReceived: PaymentRow[];
  changeOrders: ChangeOrderRow[];
  timeEntries: TimeEntryWithEmployee[];
  budgetVsActual: BudgetVsActualRow[];
  contractValue: number | null;
  estimatedValue: number | null;
}

// ── Helpers ────────────────────────────────────────────

function hoursWorked(entry: TimeEntryWithEmployee): number {
  if (!entry.clock_out) return 0;
  const ms = new Date(entry.clock_out).getTime() - new Date(entry.clock_in).getTime();
  const netMinutes = Math.max(0, ms / 60000 - (entry.break_minutes || 0));
  return netMinutes / 60;
}

function formatHours(h: number): string {
  return h.toFixed(1) + "h";
}

const paymentTypeLabels: Record<string, string> = {
  deposit: "Deposit",
  draw: "Draw",
  progress: "Progress Payment",
  final: "Final Payment",
  change_order: "Change Order Payment",
  retainage: "Retainage Release",
  other: "Other",
};

// ── Component ──────────────────────────────────────────

export function ProjectFinancesTab({
  projectId,
  estimates,
  quoteRequests,
  invoices,
  paymentsReceived,
  changeOrders,
  timeEntries,
  budgetVsActual,
  contractValue,
  estimatedValue,
}: ProjectFinancesTabProps) {
  // ── Labor (hours worked × rate) ──
  const laborData = useMemo(() => {
    let totalHours = 0;
    let totalCost = 0;
    const byEmployee = new Map<string, { name: string; hours: number; cost: number; rate: number | null }>();

    for (const entry of timeEntries) {
      const h = hoursWorked(entry);
      totalHours += h;
      const cost = h * (entry.hourly_rate || 0);
      totalCost += cost;

      const existing = byEmployee.get(entry.employee_id);
      if (existing) {
        existing.hours += h;
        existing.cost += cost;
      } else {
        byEmployee.set(entry.employee_id, { name: entry.employee_name, hours: h, cost, rate: entry.hourly_rate });
      }
    }

    return { totalHours, totalCost, byEmployee: Array.from(byEmployee.values()) };
  }, [timeEntries]);

  // ── Sub costs: committed (approved quotes) + pending ──
  const subData = useMemo(() => {
    const committed = quoteRequests.filter(q => q.status === "approved");
    const committedTotal = committed.reduce((sum, q) => sum + (Number(q.amount) || 0), 0);

    const pending = quoteRequests.filter(q =>
      ["just_sent", "awaiting_reply", "in_progress", "received"].includes(q.status || "")
    );
    const pendingTotal = pending.reduce((sum, q) => sum + (Number(q.amount) || 0), 0);

    return { committed, committedTotal, pending, pendingTotal };
  }, [quoteRequests]);

  // ── Invoices = ALL money OUT (vendor/sub bills) ──
  const invoiceData = useMemo(() => {
    const totalInvoiced = invoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const totalPaid = invoices.reduce((sum, i) => sum + (Number(i.paid_amount) || 0), 0);
    const unpaid = invoices.filter(i => i.payment_status !== "paid");
    const unpaidTotal = unpaid.reduce((sum, i) => sum + ((Number(i.amount) || 0) - (Number(i.paid_amount) || 0)), 0);
    return { totalInvoiced, totalPaid, unpaid, unpaidTotal };
  }, [invoices]);

  // ── Payments = money IN from client ──
  const paymentData = useMemo(() => {
    const totalReceived = paymentsReceived.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    return { totalReceived };
  }, [paymentsReceived]);

  // ── Change orders (from change_orders table) ──
  const coData = useMemo(() => {
    const approved = changeOrders.filter(co => co.status === "approved");
    const totalCostImpact = approved.reduce((sum, co) => sum + (Number(co.cost_impact) || 0), 0);
    const totalPriceImpact = approved.reduce((sum, co) => sum + (Number(co.price_impact) || 0), 0);
    return { all: changeOrders, approved, totalCostImpact, totalPriceImpact };
  }, [changeOrders]);

  // ── Totals ──
  const latestEstimate = estimates.length > 0 ? estimates[0] : null;
  const originalBudget = contractValue || latestEstimate?.total_price || estimatedValue || 0;
  const adjustedBudget = originalBudget + coData.totalPriceImpact;

  const totalCommitted = subData.committedTotal;
  const totalActual = laborData.totalCost + invoiceData.totalPaid;
  const totalExposure = totalCommitted + totalActual;

  const profit = paymentData.totalReceived - totalActual;
  const margin = paymentData.totalReceived > 0 ? (profit / paymentData.totalReceived) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* ── Top Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          label="Budget"
          value={formatCurrency(adjustedBudget || null)}
          sub={
            coData.totalPriceImpact > 0
              ? `${formatCurrency(originalBudget)} + ${formatCurrency(coData.totalPriceImpact)} CO`
              : contractValue ? "Contract" : latestEstimate ? `Estimate v${latestEstimate.version}` : "Est. Value"
          }
          color="text-foreground"
        />
        <SummaryCard
          label="Committed"
          value={formatCurrency(totalCommitted)}
          sub={`${subData.committed.length} approved subs`}
          color="text-amber-500"
        />
        <SummaryCard
          label="Spent"
          value={formatCurrency(totalActual)}
          sub="Labor + paid invoices"
          color="text-red-500"
        />
        <SummaryCard
          label="Change Orders"
          value={formatCurrency(coData.totalPriceImpact)}
          sub={`${coData.approved.length} approved`}
          color="text-orange-500"
        />
        <SummaryCard
          label="Received"
          value={formatCurrency(paymentData.totalReceived)}
          sub={`${paymentsReceived.length} payment${paymentsReceived.length !== 1 ? "s" : ""}`}
          color="text-green-500"
        />
        <SummaryCard
          label="Profit"
          value={formatCurrency(profit)}
          sub={paymentData.totalReceived > 0 ? `${margin.toFixed(1)}% margin` : "No payments yet"}
          color={profit >= 0 ? "text-green-500" : "text-red-500"}
          icon={profit >= 0 ? TrendingUp : TrendingDown}
        />
      </div>

      {/* ── Budget vs Spent Bar ── */}
      {adjustedBudget > 0 && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Budget Breakdown</span>
            <span className="text-muted-foreground">
              {formatCurrency(totalExposure)} of {formatCurrency(adjustedBudget)} (
              {((totalExposure / adjustedBudget) * 100).toFixed(0)}%)
            </span>
          </div>
          <div className="w-full h-4 rounded-full bg-muted overflow-hidden relative">
            <div
              className="h-full bg-red-500 absolute left-0 top-0 transition-all"
              style={{ width: `${Math.min(100, (totalActual / adjustedBudget) * 100)}%` }}
            />
            <div
              className="h-full bg-amber-500/60 absolute top-0 transition-all"
              style={{
                left: `${Math.min(100, (totalActual / adjustedBudget) * 100)}%`,
                width: `${Math.min(100 - (totalActual / adjustedBudget) * 100, (totalCommitted / adjustedBudget) * 100)}%`,
              }}
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500" /> Spent: {formatCurrency(totalActual)}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500/60" /> Committed: {formatCurrency(totalCommitted)}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-muted-foreground/20" /> Remaining: {formatCurrency(Math.max(0, adjustedBudget - totalExposure))}
            </span>
          </div>
        </div>
      )}

      {/* ── Budget vs Actual (expandable — click to see invoices) ── */}
      {budgetVsActual.length > 0 && (
        <BudgetBreakdown projectId={projectId} budgetVsActual={budgetVsActual} invoices={invoices} />
      )}

      {/* ── Labor ── */}
      <Section title="Labor" subtitle="Crew hours logged" icon={HardHat} badge={formatHours(laborData.totalHours)} total={laborData.totalCost} totalColor="text-red-500">
        {laborData.byEmployee.length === 0 ? (
          <EmptyState icon={HardHat} text="No time entries logged yet." />
        ) : (
          <div className="space-y-1.5">
            {laborData.byEmployee.sort((a, b) => b.cost - a.cost).map((emp) => (
              <div key={emp.name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{emp.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {formatHours(emp.hours)} @ {emp.rate ? `$${emp.rate.toFixed(0)}/hr` : "no rate"}
                  </span>
                </div>
                <span className="font-semibold text-red-400 shrink-0">{formatCurrency(emp.cost)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Committed (Approved Sub Quotes) ── */}
      <Section title="Committed" subtitle="Approved quotes — locked in" icon={ShieldCheck} badge={`${subData.committed.length} subs`} total={subData.committedTotal} totalColor="text-amber-500">
        {subData.committed.length === 0 ? (
          <EmptyState icon={Users} text="No approved quotes yet." />
        ) : (
          <div className="space-y-1.5">
            {subData.committed.map((q) => (
              <div key={q.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{q.subcontractor_name || "Unknown Sub"}</span>
                  {q.trade && <Badge variant="secondary" className="text-[9px] ml-2">{q.trade}</Badge>}
                </div>
                <span className="font-semibold text-amber-400 shrink-0">{formatCurrency(Number(q.amount))}</span>
              </div>
            ))}
          </div>
        )}
        {subData.pending.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
              Pending ({subData.pending.length})
            </div>
            {subData.pending.map((q) => (
              <div key={q.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/20 text-sm opacity-60">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{q.subcontractor_name || "Unknown Sub"}</span>
                  {q.trade && <Badge variant="secondary" className="text-[9px] ml-2">{q.trade}</Badge>}
                </div>
                <span className="font-medium text-muted-foreground shrink-0">
                  {q.amount ? formatCurrency(Number(q.amount)) : "TBD"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Payments Received (money IN from client) ── */}
      <Section title="Payments Received" subtitle="Client deposits, draws & payments — money in" icon={CircleDollarSign} badge={`${paymentsReceived.length}`} total={paymentData.totalReceived} totalColor="text-green-500">
        {paymentsReceived.length === 0 ? (
          <EmptyState icon={CircleDollarSign} text="No client payments recorded yet." />
        ) : (
          <div className="space-y-1.5">
            {paymentsReceived.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{paymentTypeLabels[p.payment_type] || p.payment_type}</span>
                  {p.description && <span className="text-xs text-muted-foreground ml-2">{p.description}</span>}
                  <span className="text-xs text-muted-foreground ml-2">{p.received_date}</span>
                </div>
                {p.method && (
                  <Badge variant="secondary" className="text-[9px] shrink-0">{p.method}</Badge>
                )}
                {p.reference_number && (
                  <span className="text-[10px] text-muted-foreground shrink-0">#{p.reference_number}</span>
                )}
                <span className="font-semibold text-green-500 shrink-0">{formatCurrency(Number(p.amount))}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Change Orders ── */}
      {changeOrders.length > 0 && (
        <Section title="Change Orders" subtitle="Scope & budget changes" icon={FileWarning} badge={`${changeOrders.length}`} total={coData.totalPriceImpact} totalColor="text-orange-500">
          <div className="space-y-1.5">
            {changeOrders.map((co) => (
              <div key={co.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">CO #{co.change_order_number}: {co.title}</span>
                  {co.description && (
                    <span className="text-xs text-muted-foreground ml-2 truncate">{co.description}</span>
                  )}
                </div>
                <Badge variant="outline" className={`text-[9px] shrink-0 ${
                  co.status === "approved"
                    ? "bg-green-500/15 text-green-400 border-green-500/30"
                    : co.status === "rejected"
                    ? "bg-red-500/15 text-red-400 border-red-500/30"
                    : "bg-amber-500/15 text-amber-500 border-amber-500/30"
                }`}>
                  {co.status}
                </Badge>
                <div className="text-right shrink-0">
                  <div className="font-semibold text-orange-400">+{formatCurrency(Number(co.price_impact))}</div>
                  <div className="text-[10px] text-muted-foreground">cost: {formatCurrency(Number(co.cost_impact))}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Budget Breakdown (expandable lines with invoices) ──

function BudgetBreakdown({ projectId, budgetVsActual, invoices }: {
  projectId: string;
  budgetVsActual: { line_item_id: string; description: string; trade: string | null; budgeted_cost: number; actual_invoiced: number; variance: number; percent_spent: number }[];
  invoices: Invoice[];
}) {
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [autoLinking, setAutoLinking] = useState(false);
  const router = useRouter();

  // Group invoices by estimate_line_item_id
  const invoicesByLine = useMemo(() => {
    const map = new Map<string, Invoice[]>();
    const unlinked: Invoice[] = [];
    for (const inv of invoices) {
      if (inv.estimate_line_item_id) {
        if (!map.has(inv.estimate_line_item_id)) map.set(inv.estimate_line_item_id, []);
        map.get(inv.estimate_line_item_id)!.push(inv);
      } else {
        unlinked.push(inv);
      }
    }
    return { byLine: map, unlinked };
  }, [invoices]);

  const handleAutoLink = useCallback(async () => {
    setAutoLinking(true);
    try {
      const res = await fetch("/api/auto-link-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Auto-link failed");
      router.refresh();
    } catch (err) {
      console.error("Auto-link error:", err);
    } finally {
      setAutoLinking(false);
    }
  }, [projectId, router]);

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">Budget vs Actual</h3>
          <p className="text-[10px] text-muted-foreground">Click a line to see its invoices</p>
        </div>
        <span className="text-xs text-muted-foreground">{invoices.length} invoices</span>
      </div>
      <div className="divide-y divide-border/50">
        {budgetVsActual.map((line) => {
          const over = line.variance < 0;
          const pct = Number(line.percent_spent) || 0;
          const isExpanded = expandedLine === line.line_item_id;
          const lineInvoices = invoicesByLine.byLine.get(line.line_item_id) || [];
          const hasInvoices = lineInvoices.length > 0;

          return (
            <div key={line.line_item_id}>
              <div
                className={`px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors ${isExpanded ? "bg-muted/10" : ""}`}
                onClick={() => setExpandedLine(isExpanded ? null : line.line_item_id)}
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {hasInvoices ? (
                      isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <div className="w-3.5" />
                    )}
                    <span className="text-sm font-medium">{line.description}</span>
                    {line.trade && <span className="text-[10px] text-muted-foreground">{line.trade}</span>}
                    {hasInvoices && <Badge variant="secondary" className="text-[8px]">{lineInvoices.length}</Badge>}
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-sm font-bold tabular-nums ${over ? "text-red-500" : line.actual_invoiced > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                      {formatCurrency(Number(line.actual_invoiced))}
                    </span>
                    <span className="text-xs text-muted-foreground"> / {formatCurrency(Number(line.budgeted_cost))}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-5">
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${over ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-green-500"}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-medium tabular-nums w-10 text-right ${over ? "text-red-500" : pct > 80 ? "text-amber-400" : "text-muted-foreground"}`}>
                    {pct > 0 ? `${Math.round(pct)}%` : "—"}
                  </span>
                  {over && (
                    <span className="text-[10px] text-red-500 font-medium">
                      {formatCurrency(Math.abs(Number(line.variance)))} over
                    </span>
                  )}
                </div>
              </div>

              {/* Expanded: show invoices for this line */}
              {isExpanded && (
                <div className="px-4 pb-3 pl-9 space-y-1">
                  {lineInvoices.length === 0 ? (
                    <div className="text-xs text-muted-foreground/50 py-2 italic">No invoices linked to this line yet.</div>
                  ) : (
                    lineInvoices.map((inv) => (
                      <div key={inv.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-muted/30 text-xs">
                        <span className="flex-1 font-medium truncate">{inv.vendor_name}</span>
                        {inv.invoice_number && <span className="text-muted-foreground">#{inv.invoice_number}</span>}
                        {inv.invoice_date && <span className="text-muted-foreground">{inv.invoice_date}</span>}
                        <Badge variant="outline" className={`text-[8px] ${
                          inv.payment_status === "paid" ? "bg-green-500/15 text-green-500 border-green-500/30" :
                          "bg-red-500/15 text-red-500 border-red-500/30"
                        }`}>
                          {inv.payment_status === "paid" ? "Paid" : "Unpaid"}
                        </Badge>
                        <span className="font-semibold text-red-400 tabular-nums">{formatCurrency(Number(inv.amount))}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Unlinked invoices */}
        {invoicesByLine.unlinked.length > 0 && (
          <div>
            <div
              className={`px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors ${expandedLine === "unlinked" ? "bg-muted/10" : ""}`}
              onClick={() => setExpandedLine(expandedLine === "unlinked" ? null : "unlinked")}
            >
              <div className="flex items-center gap-2">
                {expandedLine === "unlinked" ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="text-sm font-medium text-amber-400">Unlinked Expenses</span>
                <Badge variant="secondary" className="text-[8px]">{invoicesByLine.unlinked.length}</Badge>
                <button
                  onClick={(e) => { e.stopPropagation(); handleAutoLink(); }}
                  disabled={autoLinking}
                  className="ml-2 px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-[10px] font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {autoLinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  {autoLinking ? "Mapping..." : "Auto-Link to Budget"}
                </button>
                <span className="ml-auto text-sm font-bold text-amber-400 tabular-nums">
                  {formatCurrency(invoicesByLine.unlinked.reduce((s, i) => s + Number(i.amount), 0))}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 pl-5">AI maps each expense to the best-fit budget line</p>
            </div>
            {expandedLine === "unlinked" && (
              <div className="px-4 pb-3 pl-9 space-y-1">
                {invoicesByLine.unlinked.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-muted/30 text-xs">
                    <span className="flex-1 font-medium truncate">{inv.vendor_name}</span>
                    {inv.trade && <Badge variant="secondary" className="text-[8px]">{inv.trade}</Badge>}
                    {inv.invoice_date && <span className="text-muted-foreground">{inv.invoice_date}</span>}
                    <Badge variant="outline" className={`text-[8px] ${
                      inv.payment_status === "paid" ? "bg-green-500/15 text-green-500 border-green-500/30" :
                      "bg-red-500/15 text-red-500 border-red-500/30"
                    }`}>
                      {inv.payment_status === "paid" ? "Paid" : "Unpaid"}
                    </Badge>
                    <span className="font-semibold text-red-400 tabular-nums">{formatCurrency(Number(inv.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────

function SummaryCard({
  label, value, sub, color, icon: Icon,
}: {
  label: string; value: string; sub: string; color: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold mt-0.5 flex items-center gap-1 ${color}`}>
        {Icon && <Icon className="h-4 w-4" />}
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function Section({
  title, subtitle, icon: Icon, badge, total, totalColor = "text-red-400", children,
}: {
  title: string; subtitle: string; icon: React.ComponentType<{ className?: string }>;
  badge: string; total: number; totalColor?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        </div>
        <Badge variant="secondary" className="text-[9px]">{badge}</Badge>
        <span className={`text-sm font-bold ${totalColor} shrink-0`}>{formatCurrency(total)}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/30 mb-2" />
      <p className="text-xs text-muted-foreground/70">{text}</p>
    </div>
  );
}
