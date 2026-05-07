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
  FileDown,
  Plus,
  Send,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  CircleDollarSign,
  Wallet,
  ChevronDown,
  ChevronUp,
  FileText,
  Calendar,
  ClipboardList,
  ArrowRight,
  Mail,
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
  sent_to_client_at: string | null;
  client_viewed_at: string | null;
  client_view_count: number | null;
  client_signature: string | null;
  client_signed_at: string | null;
}

interface BudgetVsActualRow {
  line_item_id: string;
  description: string;
  trade: string | null;
  budgeted_cost: number;
  budgeted_price: number;
  budgeted_profit: number;
  actual_invoiced: number;
  variance: number;
  percent_spent: number;
}

interface SchedulePhaseRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  estimate_line_item_id?: string | null;
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
  schedulePhases?: SchedulePhaseRow[];
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
  schedulePhases = [],
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
      {/* ── Actions ── */}
      <div className="flex gap-2">
        <a
          href={`/api/generate-proposal-pdf?projectId=${projectId}`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
        >
          <FileText className="h-4 w-4 text-green-500" />
          Generate Proposal
        </a>
        <a
          href={`/api/generate-financial-report?projectId=${projectId}`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
        >
          <ClipboardList className="h-4 w-4 text-amber-500" />
          Owner Report
        </a>
      </div>

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
        <BudgetBreakdown projectId={projectId} budgetVsActual={budgetVsActual} invoices={invoices} quoteRequests={quoteRequests} schedulePhases={schedulePhases} />
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
      <Section title="Change Orders" subtitle="Scope & budget changes" icon={FileWarning} badge={`${changeOrders.length}`} total={coData.totalPriceImpact} totalColor="text-orange-500">
        <div className="space-y-1.5">
          {changeOrders.map((co) => (
            <div key={co.id} className="rounded-lg bg-muted/30 overflow-hidden">
              {/* Top row: title + amount */}
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">CO #{co.change_order_number}: {co.title}</span>
                    <Badge variant="outline" className={`text-[9px] ${
                      co.status === "approved"
                        ? "bg-green-500/15 text-green-400 border-green-500/30"
                        : co.status === "rejected"
                        ? "bg-red-500/15 text-red-400 border-red-500/30"
                        : "bg-amber-500/15 text-amber-500 border-amber-500/30"
                    }`}>
                      {co.status}
                    </Badge>
                    {/* Tracking */}
                    {co.sent_to_client_at && !co.client_viewed_at && !co.client_signature && (
                      <span className="text-[9px] text-muted-foreground">Sent</span>
                    )}
                    {co.client_viewed_at && !co.client_signature && (
                      <span className="text-[9px] text-blue-400 font-medium" title={`Viewed ${co.client_view_count || 1}x`}>
                        Viewed{co.client_view_count && co.client_view_count > 1 ? ` ${co.client_view_count}x` : ""}
                      </span>
                    )}
                    {co.client_signature && (
                      <span className="text-[9px] text-green-400 font-medium" title={`Signed by ${co.client_signature}`}>
                        Signed by {co.client_signature}
                      </span>
                    )}
                  </div>
                  {co.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{co.description}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-orange-400">+{formatCurrency(Number(co.price_impact))}</div>
                  <div className="text-[10px] text-muted-foreground">cost: {formatCurrency(Number(co.cost_impact))}</div>
                </div>
              </div>
              {/* Bottom row: actions */}
              <div className="flex items-center gap-1.5 px-4 py-2 border-t border-border/30 bg-muted/20">
                <a
                  href={`/api/generate-change-order?changeOrderId=${co.id}`}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium hover:bg-muted transition-colors"
                >
                  <FileDown className="h-3 w-3" /> PDF
                </a>
                <TestSendCOButton changeOrderId={co.id} />
                <SendCOButton changeOrderId={co.id} coNumber={co.change_order_number} />
                {co.status !== "approved" && (
                  <ApproveCOButton changeOrderId={co.id} coNumber={co.change_order_number} />
                )}
                <div className="flex-1" />
                <DeleteCOButton changeOrderId={co.id} coNumber={co.change_order_number} />
              </div>
            </div>
          ))}
          {changeOrders.length === 0 && (
            <p className="text-xs text-muted-foreground py-2 text-center">No change orders yet</p>
          )}
          <div className="pt-2">
            <ChangeOrderDialog projectId={projectId} />
          </div>
        </div>
      </Section>
    </div>
  );
}

// ── Budget Breakdown (expandable lines with invoices) ──

function BudgetBreakdown({ projectId, budgetVsActual, invoices, quoteRequests, schedulePhases }: {
  projectId: string;
  budgetVsActual: BudgetVsActualRow[];
  invoices: Invoice[];
  quoteRequests: QuoteRequest[];
  schedulePhases: SchedulePhaseRow[];
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

  // Group quotes by estimate_line_item_id
  const quotesByLine = useMemo(() => {
    const map = new Map<string, QuoteRequest[]>();
    for (const q of quoteRequests) {
      if (q.estimate_line_item_id) {
        if (!map.has(q.estimate_line_item_id)) map.set(q.estimate_line_item_id, []);
        map.get(q.estimate_line_item_id)!.push(q);
      }
    }
    return map;
  }, [quoteRequests]);

  // Group schedule phases by estimate_line_item_id
  const phasesByLine = useMemo(() => {
    const map = new Map<string, SchedulePhaseRow[]>();
    for (const p of schedulePhases) {
      if (p.estimate_line_item_id) {
        if (!map.has(p.estimate_line_item_id)) map.set(p.estimate_line_item_id, []);
        map.get(p.estimate_line_item_id)!.push(p);
      }
    }
    return map;
  }, [schedulePhases]);

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
          <h3 className="text-sm font-semibold">Line Item Lifecycle</h3>
          <p className="text-[10px] text-muted-foreground">Estimate → Quotes → Schedule → Actuals → Profit</p>
        </div>
        <span className="text-xs text-muted-foreground">{invoices.length} invoices</span>
      </div>
      <div className="divide-y divide-border/50">
        {budgetVsActual.map((line) => {
          const over = line.variance < 0;
          const pct = Number(line.percent_spent) || 0;
          const isExpanded = expandedLine === line.line_item_id;
          const lineInvoices = invoicesByLine.byLine.get(line.line_item_id) || [];
          const lineQuotes = quotesByLine.get(line.line_item_id) || [];
          const linePhases = phasesByLine.get(line.line_item_id) || [];
          const hasDetails = lineInvoices.length > 0 || lineQuotes.length > 0 || linePhases.length > 0;

          // Lifecycle stage indicators
          const hasEstimate = true; // always true if it's in budget_vs_actual
          const hasQuotes = lineQuotes.length > 0;
          const hasSchedule = linePhases.length > 0;
          const hasActuals = lineInvoices.length > 0;

          return (
            <div key={line.line_item_id}>
              <div
                className={`px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors ${isExpanded ? "bg-muted/10" : ""}`}
                onClick={() => setExpandedLine(isExpanded ? null : line.line_item_id)}
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <span className="text-sm font-medium">{line.description}</span>
                    {line.trade && <span className="text-[10px] text-muted-foreground">{line.trade}</span>}
                    {/* Lifecycle stage dots */}
                    <div className="hidden sm:flex items-center gap-0.5 ml-1">
                      <LifecycleDot active={hasEstimate} label="Est" />
                      <ArrowRight className="h-2 w-2 text-muted-foreground/30" />
                      <LifecycleDot active={hasQuotes} label="Quote" />
                      <ArrowRight className="h-2 w-2 text-muted-foreground/30" />
                      <LifecycleDot active={hasSchedule} label="Sched" />
                      <ArrowRight className="h-2 w-2 text-muted-foreground/30" />
                      <LifecycleDot active={hasActuals} label="Actual" />
                    </div>
                  </div>
                  {(() => {
                    const clientPrice = Number(line.budgeted_price || 0);
                    const actualSpent = Number(line.actual_invoiced || 0);
                    const committedQuotes = lineQuotes
                      .filter(q => q.status === "approved")
                      .reduce((sum, q) => sum + (Number(q.amount) || 0), 0);
                    const profit = actualSpent > 0
                      ? clientPrice - actualSpent
                      : Number(line.budgeted_profit || 0);
                    const profitPct = clientPrice > 0 ? Math.round((profit / clientPrice) * 100) : 0;

                    return (
                      <div className="text-right shrink-0 flex items-center gap-3">
                        <div className="text-right hidden sm:block">
                          <div className="text-[10px] text-muted-foreground">Client Price</div>
                          <div className="text-xs font-semibold text-foreground tabular-nums">{formatCurrency(clientPrice)}</div>
                        </div>
                        <div className="text-right hidden sm:block">
                          <div className="text-[10px] text-muted-foreground">Profit</div>
                          <div className={`text-xs font-semibold tabular-nums ${profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                            {formatCurrency(profit)}
                            <span className="text-[9px] ml-0.5 opacity-70">{profitPct}%</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`text-sm font-bold tabular-nums ${over ? "text-red-500" : actualSpent > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                            {formatCurrency(actualSpent)}
                          </span>
                          <span className="text-xs text-muted-foreground"> / {formatCurrency(Number(line.budgeted_cost))}</span>
                        </div>
                      </div>
                    );
                  })()}
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

              {/* Expanded: full lifecycle for this line */}
              {isExpanded && (
                <div className="px-4 pb-3 pl-9 space-y-3">
                  {/* Estimate (always shown) */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <ClipboardList className="h-3 w-3 text-blue-400" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">Estimate</span>
                    </div>
                    <div className="flex items-center gap-4 px-3 py-1.5 rounded bg-blue-500/5 text-xs">
                      <span className="text-muted-foreground">Cost:</span>
                      <span className="font-medium tabular-nums">{formatCurrency(Number(line.budgeted_cost))}</span>
                      <span className="text-muted-foreground">Price:</span>
                      <span className="font-medium tabular-nums">{formatCurrency(Number(line.budgeted_price))}</span>
                      <span className="text-muted-foreground">Profit:</span>
                      <span className={`font-medium tabular-nums ${Number(line.budgeted_profit) >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {formatCurrency(Number(line.budgeted_profit))}
                      </span>
                    </div>
                  </div>

                  {/* Quotes */}
                  {lineQuotes.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Receipt className="h-3 w-3 text-amber-400" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                          Sub Quotes ({lineQuotes.length})
                        </span>
                      </div>
                      {lineQuotes.map((q) => (
                        <div key={q.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-amber-500/5 text-xs mb-1">
                          <span className="flex-1 font-medium truncate">{q.subcontractor_name || "Unknown Sub"}</span>
                          {q.trade && <Badge variant="secondary" className="text-[8px]">{q.trade}</Badge>}
                          <Badge variant="outline" className={`text-[8px] ${
                            q.status === "approved" || q.status === "accepted" ? "bg-green-500/15 text-green-500 border-green-500/30" :
                            q.status === "declined" ? "bg-red-500/15 text-red-500 border-red-500/30" :
                            "bg-amber-500/15 text-amber-500 border-amber-500/30"
                          }`}>
                            {q.status}
                          </Badge>
                          <span className="font-semibold text-amber-400 tabular-nums">
                            {q.amount ? formatCurrency(Number(q.amount)) : "TBD"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Schedule */}
                  {linePhases.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Calendar className="h-3 w-3 text-purple-400" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-400">
                          Schedule ({linePhases.length})
                        </span>
                      </div>
                      {linePhases.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-purple-500/5 text-xs mb-1">
                          <span className="flex-1 font-medium truncate">{p.name}</span>
                          <span className="text-muted-foreground">{p.start_date} — {p.end_date}</span>
                          <Badge variant="outline" className={`text-[8px] ${
                            p.status === "completed" ? "bg-green-500/15 text-green-500 border-green-500/30" :
                            p.status === "in_progress" ? "bg-blue-500/15 text-blue-500 border-blue-500/30" :
                            "bg-muted text-muted-foreground border-muted"
                          }`}>
                            {p.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Invoices (Actuals) */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Receipt className="h-3 w-3 text-red-400" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400">
                        Invoices ({lineInvoices.length})
                      </span>
                    </div>
                    {lineInvoices.length === 0 ? (
                      <div className="text-xs text-muted-foreground/50 py-1 px-3 italic">No invoices linked yet.</div>
                    ) : (
                      lineInvoices.map((inv) => (
                        <div key={inv.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-500/5 text-xs mb-1">
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

                  {/* Profit summary when there are actuals */}
                  {lineInvoices.length > 0 && (() => {
                    const clientPrice = Number(line.budgeted_price || 0);
                    const actualSpent = Number(line.actual_invoiced || 0);
                    const realProfit = clientPrice - actualSpent;
                    const realMargin = clientPrice > 0 ? (realProfit / clientPrice) * 100 : 0;
                    return (
                      <div className="flex items-center gap-4 px-3 py-2 rounded bg-muted/30 text-xs border border-dashed">
                        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground font-medium">Bottom Line:</span>
                        <span className="text-foreground tabular-nums">Charged {formatCurrency(clientPrice)}</span>
                        <span className="text-red-400 tabular-nums">Spent {formatCurrency(actualSpent)}</span>
                        <span className={`font-bold tabular-nums ${realProfit >= 0 ? "text-green-500" : "text-red-500"}`}>
                          Profit {formatCurrency(realProfit)} ({realMargin.toFixed(1)}%)
                        </span>
                      </div>
                    );
                  })()}
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

// ── Lifecycle dot indicator ───────────────────────────

function LifecycleDot({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[8px] font-medium ${
        active ? "text-green-500" : "text-muted-foreground/30"
      }`}
      title={`${label}: ${active ? "Connected" : "Not connected"}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${active ? "bg-green-500" : "bg-muted-foreground/20"}`} />
      {label}
    </span>
  );
}

// ── Sub-components ─────────────────────────────────────

function ApproveCOButton({ changeOrderId, coNumber }: { changeOrderId: string; coNumber: number }) {
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleApprove() {
    setSaving(true);
    const supabase = (await import("@/lib/supabase/client")).createClient();
    await supabase.from("change_orders").update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: "Manual approval",
    }).eq("id", changeOrderId);
    setSaving(false);
    router.refresh();
  }

  return (
    <button
      onClick={handleApprove}
      disabled={saving}
      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-colors disabled:opacity-50"
    >
      <CheckCircle2 className="h-3 w-3" />
      {saving ? "Approving..." : "Approve"}
    </button>
  );
}

function DeleteCOButton({ changeOrderId, coNumber }: { changeOrderId: string; coNumber: number }) {
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    const supabase = (await import("@/lib/supabase/client")).createClient();
    await supabase.from("change_orders").delete().eq("id", changeOrderId);
    setConfirming(false);
    router.refresh();
  }

  if (confirming) return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-red-400">Delete CO #{coNumber}?</span>
      <button onClick={handleDelete} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30">Yes</button>
      <button onClick={() => setConfirming(false)} className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-muted">No</button>
    </div>
  );

  return (
    <button
      onClick={() => setConfirming(true)}
      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
    >
      <Trash2 className="h-3 w-3" /> Delete
    </button>
  );
}

function TestSendCOButton({ changeOrderId }: { changeOrderId: string }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<"idle" | "ok" | "err">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleTest() {
    setSending(true);
    setError(null);
    setResult("idle");
    try {
      const res = await fetch("/api/test-send-change-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeOrderId }),
      });
      const data = await res.json();
      if (data.success) {
        setResult("ok");
        // Reset the "Sent" state after a few seconds so it's testable repeatedly.
        setTimeout(() => setResult("idle"), 4000);
      } else {
        setResult("err");
        setError(data.error || "Test send failed");
      }
    } catch (e) {
      setResult("err");
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        onClick={handleTest}
        disabled={sending}
        className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-colors disabled:opacity-50 ${
          result === "ok"
            ? "border-green-500/30 text-green-400 bg-green-500/10"
            : "border-border text-muted-foreground hover:bg-muted"
        }`}
        title="Email the PDF to yourself only. Client doesn't receive anything."
      >
        <Mail className="h-3 w-3" />
        {sending ? "Sending..." : result === "ok" ? "Sent to you" : "Test Send"}
      </button>
      {error && <span className="text-[9px] text-red-400 shrink-0">{error}</span>}
    </>
  );
}

function SendCOButton({ changeOrderId, coNumber }: { changeOrderId: string; coNumber: number }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setSending(true);
    setError(null);
    const res = await fetch("/api/send-change-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changeOrderId }),
    });
    const data = await res.json();
    setSending(false);
    if (data.success) setSent(true);
    else setError(data.error || "Failed");
  }

  if (sent) return (
    <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-green-400">
      Sent
    </span>
  );

  return (
    <>
      <button
        onClick={handleSend}
        disabled={sending}
        className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
        title="Sends PDF + approval link to client, CCs Ryan"
      >
        <Send className="h-3 w-3" />
        {sending ? "Sending..." : "Send to Client"}
      </button>
      {error && <span className="text-[9px] text-red-400 shrink-0">{error}</span>}
    </>
  );
}

function ChangeOrderDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [costImpact, setCostImpact] = useState("");
  const [priceImpact, setPriceImpact] = useState("");
  const router = useRouter();

  async function handleCreate() {
    if (!title) return;
    setSaving(true);
    const supabase = (await import("@/lib/supabase/client")).createClient();

    // Get next CO number
    const { data: existing } = await supabase
      .from("change_orders")
      .select("change_order_number")
      .eq("project_id", projectId)
      .order("change_order_number", { ascending: false })
      .limit(1);

    const nextNum = existing?.length ? existing[0].change_order_number + 1 : 1;

    await supabase.from("change_orders").insert({
      project_id: projectId,
      change_order_number: nextNum,
      title,
      description: description || null,
      cost_impact: Number(costImpact) || 0,
      price_impact: Number(priceImpact) || 0,
      status: "draft",
    });

    setSaving(false);
    setOpen(false);
    setTitle("");
    setDescription("");
    setCostImpact("");
    setPriceImpact("");
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 transition-colors"
      >
        <Plus className="h-3 w-3" />
        New Change Order
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-xl border shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">New Change Order</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Title *</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Extra framing for header"
                  className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detailed scope of the change..."
                  rows={3}
                  className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Our Cost ($)</label>
                  <input
                    type="number"
                    value={costImpact}
                    onChange={(e) => setCostImpact(e.target.value)}
                    placeholder="0"
                    className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Client Price ($)</label>
                  <input
                    type="number"
                    value={priceImpact}
                    onChange={(e) => setPriceImpact(e.target.value)}
                    placeholder="0"
                    className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-md text-sm border hover:bg-muted">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={saving || !title}
                className="px-4 py-2 rounded-md text-sm font-medium bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {saving ? "Creating..." : "Create CO"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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
