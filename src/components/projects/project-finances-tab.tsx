"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetTitle,
} from "@/components/ui/bottom-sheet";
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
  Pencil,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  CircleDollarSign,
  Wallet,
  ChevronDown,
  ChevronUp,
  Calendar,
  ClipboardList,
  ArrowRight,
  ArrowLeftRight,
  ArrowUp,
  Mail,
  ExternalLink,
  ScrollText,
  Split,
  X,
  Lock,
  LockOpen,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { moveInvoiceToLine, moveWorkerHours } from "@/lib/actions/line-reassign";
import { closeLineItem, reopenLineItem } from "@/lib/actions/line-closeout";
import { InvoiceSplitDialog } from "./invoice-split-dialog";
import { createClientInvoice, deleteClientInvoice, markClientInvoicePaid, syncClientInvoiceToQuickBooks } from "@/lib/actions/invoices";
import { createChangeOrder, pushChangeOrderToQB } from "@/lib/actions/change-orders";
import { PaymentScheduleCard, type ContractState, type PaymentMilestoneRow } from "@/components/projects/payment-schedule-card";
import { pickCurrentEstimate } from "@/lib/estimates/current";
import { PermitScopeCard } from "@/components/projects/permit-scope-card";
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

/** Clocked labor rolled up per estimate line item (shape of getProjectLaborCost().byLineItem). */
export interface LaborLineRow {
  key: string;
  lineItemId: string | null;
  description: string;
  cents: number;
  hours: number;
  /** Per-person breakdown; cents/rate are null when this viewer may not see that person's pay. */
  workers?: {
    profileId: string;
    name: string;
    hours: number;
    cents: number | null;
    rate: number | null;
  }[];
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
  quickbooks_pushed_at?: string | null;
}

interface ClientInvoiceRow {
  id: string;
  project_id: string;
  invoice_number: number;
  title: string;
  description: string | null;
  line_items: { description: string; amount: number }[] | null;
  amount: number;
  terms: string | null;
  due_date: string | null;
  status: string;
  sent_to_client_at: string | null;
  client_viewed_at: string | null;
  client_view_count: number | null;
  paid_at: string | null;
  paid_amount: number | null;
  quickbooks_invoice_id: string | null;
  quickbooks_doc_number: string | null;
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
  is_section_header?: boolean | null;
  is_locked?: boolean | null;
  closed_at?: string | null;
  closed_margin?: number | null;
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
  clientInvoices: ClientInvoiceRow[];
  timeEntries: TimeEntryWithEmployee[];
  budgetVsActual: BudgetVsActualRow[];
  /** Clocked crew labor per line item — merged into each line's Actual alongside invoices. */
  laborByLine?: LaborLineRow[];
  schedulePhases?: SchedulePhaseRow[];
  paymentMilestones?: PaymentMilestoneRow[];
  contractValue: number | null;
  estimatedValue: number | null;
  contract?: ContractState;
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
  clientInvoices,
  timeEntries,
  budgetVsActual,
  laborByLine = [],
  schedulePhases = [],
  paymentMilestones = [],
  contractValue,
  estimatedValue,
  contract,
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

  // ── Client invoices: live vs premade-at-signing ──
  // Signing a contract premakes one draft invoice per payment milestone. Those
  // are the schedule sitting ready to send, NOT money the client owes yet, so
  // they render in their own dimmed group instead of inflating the A/R list.
  const { liveInvoices, scheduledInvoices, scheduledTotal } = useMemo(() => {
    const milestoneInvoiceIds = new Set(
      paymentMilestones.map((m) => m.client_invoice_id).filter(Boolean) as string[],
    );
    const scheduled = clientInvoices.filter(
      (inv) => inv.status === "draft" && milestoneInvoiceIds.has(inv.id),
    );
    const scheduledIds = new Set(scheduled.map((i) => i.id));
    return {
      liveInvoices: clientInvoices.filter((inv) => !scheduledIds.has(inv.id)),
      scheduledInvoices: scheduled,
      scheduledTotal: scheduled.reduce((s, i) => s + (Number(i.amount) || 0), 0),
    };
  }, [clientInvoices, paymentMilestones]);

  // ── Change orders (from change_orders table) ──
  const coData = useMemo(() => {
    const approved = changeOrders.filter(co => co.status === "approved");
    const totalCostImpact = approved.reduce((sum, co) => sum + (Number(co.cost_impact) || 0), 0);
    const totalPriceImpact = approved.reduce((sum, co) => sum + (Number(co.price_impact) || 0), 0);
    return { all: changeOrders, approved, totalCostImpact, totalPriceImpact };
  }, [changeOrders]);

  // ── Totals ──
  const latestEstimate = pickCurrentEstimate(estimates, contract?.estimateId);
  // A locked contract is the price, full stop — estimate edits after signing
  // must not move it. Repricing goes through a change order.
  const originalBudget =
    (contract?.lockedAt ? contract.lockedAmount : null) ||
    contractValue ||
    latestEstimate?.total_price ||
    estimatedValue ||
    0;
  const adjustedBudget = originalBudget + coData.totalPriceImpact;

  const totalCommitted = subData.committedTotal;
  const totalActual = laborData.totalCost + invoiceData.totalPaid;
  const totalExposure = totalCommitted + totalActual;

  const profit = paymentData.totalReceived - totalActual;
  const margin = paymentData.totalReceived > 0 ? (profit / paymentData.totalReceived) * 100 : 0;

  const pctSpent = adjustedBudget > 0 ? Math.min(100, (totalActual / adjustedBudget) * 100) : 0;
  const pctCommitted = adjustedBudget > 0
    ? Math.min(100 - pctSpent, (totalCommitted / adjustedBudget) * 100)
    : 0;

  return (
    <div className="space-y-5">
      {/* ── Header card ── */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
              <Wallet className="h-5 w-5 text-amber-500" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Project Money</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {adjustedBudget > 0 ? (
                  <>
                    {formatCurrency(adjustedBudget)} budget
                    {coData.totalPriceImpact > 0
                      ? ` · ${formatCurrency(originalBudget)} + ${formatCurrency(coData.totalPriceImpact)} CO`
                      : contractValue
                        ? " · contract"
                        : latestEstimate
                          ? ` · estimate v${latestEstimate.version}`
                          : " · estimated value"}
                  </>
                ) : (
                  "No budget set yet — add a contract value or estimate"
                )}
              </p>
            </div>
            <div className="text-right">
              <p className={`text-lg font-semibold tabular-nums ${profit >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                {formatCurrency(profit)}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {paymentData.totalReceived > 0 ? `${margin.toFixed(1)}% margin` : "profit"}
              </p>
            </div>
          </div>

          {adjustedBudget > 0 && (
            <div className="mt-3 space-y-2">
              <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-red-500 transition-all"
                  style={{ width: `${pctSpent}%` }}
                />
                <div
                  className="absolute inset-y-0 bg-amber-500/70 transition-all"
                  style={{ left: `${pctSpent}%`, width: `${pctCommitted}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                  Spent {formatCurrency(totalActual)}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500/70" />
                  Committed {formatCurrency(totalCommitted)}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" />
                  Left {formatCurrency(Math.max(0, adjustedBudget - totalExposure))}
                </span>
                <span className="ml-auto font-medium tabular-nums">
                  {((totalExposure / adjustedBudget) * 100).toFixed(0)}% of budget
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Stat tiles ── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          icon={Wallet}
          chipClass="bg-sky-500/15 text-sky-500"
          value={formatCurrency(adjustedBudget || null)}
          label="Budget"
          jumpTo={budgetVsActual.length > 0 ? "fin-budget" : undefined}
          sub={
            coData.totalPriceImpact > 0
              ? `${formatCurrency(originalBudget)} + ${formatCurrency(coData.totalPriceImpact)} CO`
              : contractValue ? "Contract" : latestEstimate ? `Estimate v${latestEstimate.version}` : "Est. value"
          }
        />
        <StatTile
          icon={ShieldCheck}
          chipClass="bg-amber-500/15 text-amber-500"
          valueClass="text-amber-500"
          value={formatCurrency(totalCommitted)}
          label="Committed"
          jumpTo="fin-committed"
          sub={`${subData.committed.length} approved sub${subData.committed.length !== 1 ? "s" : ""}`}
        />
        <StatTile
          icon={Receipt}
          chipClass="bg-red-500/15 text-red-500"
          valueClass="text-red-500"
          value={formatCurrency(totalActual)}
          label="Spent"
          jumpTo="fin-labor"
          sub="Labor + paid invoices"
        />
        <StatTile
          icon={FileWarning}
          chipClass="bg-orange-500/15 text-orange-500"
          valueClass="text-orange-500"
          value={formatCurrency(coData.totalPriceImpact)}
          label="Change Orders"
          jumpTo="fin-change-orders"
          sub={`${coData.approved.length} approved`}
        />
        <StatTile
          icon={CircleDollarSign}
          chipClass="bg-emerald-500/15 text-emerald-500"
          valueClass="text-emerald-500"
          value={formatCurrency(paymentData.totalReceived)}
          label="Received"
          jumpTo="fin-invoices"
          sub={`${paymentsReceived.length} payment${paymentsReceived.length !== 1 ? "s" : ""}`}
        />
        <StatTile
          icon={profit >= 0 ? TrendingUp : TrendingDown}
          chipClass={profit >= 0 ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"}
          valueClass={profit >= 0 ? "text-emerald-500" : "text-red-500"}
          value={formatCurrency(profit)}
          label="Profit"
          jumpTo="fin-invoices"
          sub={paymentData.totalReceived > 0 ? `${margin.toFixed(1)}% margin` : "No payments yet"}
        />
      </div>

      {/* ── Budget vs Actual (expandable — click to see invoices) ── */}
      {budgetVsActual.length > 0 && (
        <div id="fin-budget" className="scroll-mt-20">
          <BudgetBreakdown projectId={projectId} budgetVsActual={budgetVsActual} invoices={invoices} quoteRequests={quoteRequests} schedulePhases={schedulePhases} laborByLine={laborByLine} />
        </div>
      )}

      {/* ── Contract (its own section, next to Budget) ── */}
      <Section
        id="fin-contract"
        title="Contract"
        subtitle={
          contract?.lockedAt
            ? "Signed by both parties — the price is locked"
            : "Send it for signature — the payment schedule below prints inside it"
        }
        icon={ScrollText}
        iconColorClass="bg-teal-500/15 text-teal-500"
        badge={contract?.lockedAt ? "Locked" : `${paymentMilestones.length} milestones`}
        total={originalBudget}
        totalColor="text-teal-500"
      >
        <PaymentScheduleCard
          projectId={projectId}
          milestones={paymentMilestones}
          clientInvoices={clientInvoices}
          contractBasis={originalBudget}
          contract={contract}
        />
      </Section>

      {/* ── Permit Scope (town-ready description, no contract/prices) ── */}
      <PermitScopeCard projectId={projectId} />

      {/* ── Labor ── */}
      <Section id="fin-labor" title="Labor" subtitle="Crew hours logged" icon={HardHat} iconColorClass="bg-red-500/15 text-red-500" badge={formatHours(laborData.totalHours)} total={laborData.totalCost} totalColor="text-red-500">
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
      <Section id="fin-committed" title="Committed" subtitle="Approved quotes — locked in" icon={ShieldCheck} iconColorClass="bg-amber-500/15 text-amber-500" badge={`${subData.committed.length} subs`} total={subData.committedTotal} totalColor="text-amber-500">
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

      {/* ── Change Orders ── */}
      <Section id="fin-change-orders" title="Change Orders" subtitle="Scope & budget changes" icon={FileWarning} iconColorClass="bg-orange-500/15 text-orange-500" badge={`${changeOrders.length}`} total={coData.totalPriceImpact} totalColor="text-orange-500">
        <div className="space-y-1.5">
          {changeOrders.map((co) => (
            <div key={co.id} className="rounded-xl bg-muted/30 overflow-hidden">
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
                      <Badge variant="outline" className="text-[9px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                        Sent {new Date(co.sent_to_client_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </Badge>
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
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-t border-border/30 bg-muted/20">
                <a
                  href={`/api/generate-change-order?changeOrderId=${co.id}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium hover:bg-muted transition-colors"
                >
                  <FileDown className="h-3 w-3" /> PDF
                </a>
                <EditCOButton co={co} />
                <TestSendCOButton changeOrderId={co.id} />
                <SendCOButton changeOrderId={co.id} coNumber={co.change_order_number} sentAt={co.sent_to_client_at} />
                {co.status !== "approved" && (
                  <ApproveCOButton changeOrderId={co.id} coNumber={co.change_order_number} />
                )}
                {(co.status === "approved" || co.client_signed_at) && (
                  <PushCOToQBButton co={co} projectId={projectId} />
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

      {/* ── Client Invoices & Payments (all money IN together) ── */}
      <Section
        id="fin-invoices"
        title="Client Invoices & Payments"
        subtitle="Money in — invoice the client, then record what lands"
        icon={Receipt}
        iconColorClass="bg-emerald-500/15 text-emerald-500"
        badge={
          scheduledInvoices.length > 0
            ? `${liveInvoices.length} inv · ${scheduledInvoices.length} scheduled · ${paymentsReceived.length} pmts`
            : `${clientInvoices.length} inv · ${paymentsReceived.length} pmts`
        }
        total={paymentData.totalReceived}
        totalColor="text-emerald-500"
      >
        <div className="space-y-1.5">
          {liveInvoices.map((inv) => (
            <div key={inv.id} className="rounded-xl bg-muted/30 overflow-hidden">
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-sm">Invoice #{inv.invoice_number}: {inv.title}</span>
                    <Badge variant="outline" className={`text-[9px] ${
                      inv.status === "paid"
                        ? "bg-green-500/15 text-green-400 border-green-500/30"
                        : inv.status === "void"
                        ? "bg-red-500/15 text-red-400 border-red-500/30"
                        : inv.status === "sent"
                        ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                        : "bg-amber-500/15 text-amber-500 border-amber-500/30"
                    }`}>
                      {inv.status}
                    </Badge>
                    {inv.sent_to_client_at && inv.status !== "paid" && (
                      <span className="text-[9px] text-muted-foreground">Sent</span>
                    )}
                    {inv.client_viewed_at && inv.status !== "paid" && (
                      <span className="text-[9px] text-blue-400 font-medium" title={`Viewed ${inv.client_view_count || 1}x`}>
                        Viewed{inv.client_view_count && inv.client_view_count > 1 ? ` ${inv.client_view_count}x` : ""}
                      </span>
                    )}
                  </div>
                  {inv.line_items && inv.line_items.length > 0 && (
                    <div className="text-[11px] text-muted-foreground space-y-0.5 mt-1">
                      {inv.line_items.map((li, idx) => (
                        <div key={idx} className="flex justify-between gap-3 max-w-xs">
                          <span className="truncate">{li.description}</span>
                          <span className="tabular-nums shrink-0">{formatCurrency(Number(li.amount))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">{inv.terms || "Due on receipt"}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-green-400">{formatCurrency(Number(inv.amount))}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-t border-border/30 bg-muted/20">
                <a
                  href={`/api/generate-client-invoice?invoiceId=${inv.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium hover:bg-muted transition-colors"
                >
                  <FileDown className="h-3 w-3" /> PDF
                </a>
                <TestSendInvoiceButton invoiceId={inv.id} />
                <SendInvoiceButton invoiceId={inv.id} invoiceNumber={inv.invoice_number} />
                {inv.status !== "paid" && (
                  <MarkInvoicePaidButton invoiceId={inv.id} projectId={projectId} />
                )}
                <CreateInQuickBooksButton
                  invoiceId={inv.id}
                  projectId={projectId}
                  qbInvoiceId={inv.quickbooks_invoice_id}
                  qbDocNumber={inv.quickbooks_doc_number}
                />
                <div className="flex-1" />
                <DeleteInvoiceButton invoiceId={inv.id} projectId={projectId} invoiceNumber={inv.invoice_number} />
              </div>
            </div>
          ))}
          {clientInvoices.length === 0 && (
            <p className="text-xs text-muted-foreground py-2 text-center">No client invoices yet</p>
          )}

          {/* Premade at signing — the whole payment schedule is sitting here
              ready to send, one click each, in the order the job hits them. */}
          {scheduledInvoices.length > 0 && (
            <div className="pt-3 space-y-1.5">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
                Scheduled — not sent yet ({scheduledInvoices.length}) · {formatCurrency(scheduledTotal)}
              </div>
              {scheduledInvoices.map((inv) => (
                <div key={inv.id} className="rounded-xl border border-dashed border-border/60 bg-muted/20 overflow-hidden">
                  <div className="flex items-start gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold text-sm text-muted-foreground">
                          Invoice #{inv.invoice_number}: {inv.title}
                        </span>
                        <Badge variant="outline" className="text-[9px] bg-muted text-muted-foreground border-border">
                          scheduled
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{inv.terms || "Due on receipt"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-muted-foreground">{formatCurrency(Number(inv.amount))}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-t border-border/30">
                    <a
                      href={`/api/generate-client-invoice?invoiceId=${inv.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium hover:bg-muted transition-colors"
                    >
                      <FileDown className="h-3 w-3" /> PDF
                    </a>
                    <TestSendInvoiceButton invoiceId={inv.id} />
                    <SendInvoiceButton invoiceId={inv.id} invoiceNumber={inv.invoice_number} />
                    <MarkInvoicePaidButton invoiceId={inv.id} projectId={projectId} />
                    <CreateInQuickBooksButton
                      invoiceId={inv.id}
                      projectId={projectId}
                      qbInvoiceId={inv.quickbooks_invoice_id}
                      qbDocNumber={inv.quickbooks_doc_number}
                    />
                    <div className="flex-1" />
                    <DeleteInvoiceButton invoiceId={inv.id} projectId={projectId} invoiceNumber={inv.invoice_number} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2">
            <ClientInvoiceDialog projectId={projectId} />
          </div>

          {/* Payments received — the other half of money in */}
          <div className="pt-3 space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
              Payments received ({paymentsReceived.length}) · {formatCurrency(paymentData.totalReceived)}
            </div>
            {paymentsReceived.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center">No client payments recorded yet</p>
            ) : (
              paymentsReceived.map((p) => (
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
              ))
            )}
          </div>
        </div>
      </Section>

      {/* Floating back-to-top — the finances tab gets LONG */}
      <BackToTopButton />
    </div>
  );
}

// ── Move-to-line picker (manual re-filing of invoices and hours) ──

function MoveToLineMenu({ targets, excludeId, disabled, onPick }: {
  targets: { id: string; description: string }[];
  excludeId?: string | null;
  disabled?: boolean;
  onPick: (lineItemId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          disabled={disabled}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 shrink-0"
          title="Move to another line item"
        >
          {disabled ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto w-64" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Move to line item</DropdownMenuLabel>
        {targets.filter((t) => t.id !== excludeId).map((t) => (
          <DropdownMenuItem
            key={t.id}
            className="text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onPick(t.id);
            }}
          >
            {t.description}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Budget Breakdown (expandable lines with invoices) ──

function BudgetBreakdown({ projectId, budgetVsActual, invoices, quoteRequests, schedulePhases, laborByLine = [] }: {
  projectId: string;
  laborByLine?: LaborLineRow[];
  budgetVsActual: BudgetVsActualRow[];
  invoices: Invoice[];
  quoteRequests: QuoteRequest[];
  schedulePhases: SchedulePhaseRow[];
}) {
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [autoLinking, setAutoLinking] = useState(false);
  const [movingKey, setMovingKey] = useState<string | null>(null);
  const [splitInv, setSplitInv] = useState<{ id: string; vendor: string; amount: number } | null>(null);
  const [receipt, setReceipt] = useState<{
    vendor: string;
    amount: number;
    loading: boolean;
    url?: string;
    isPdf?: boolean;
    driveUrl?: string;
    missing?: boolean;
  } | null>(null);
  const router = useRouter();

  // Click an invoice row → pop up the receipt picture. Attachment might live in
  // either bucket (same fallback as /spent/[id]); Drive-only receipts embed the
  // Drive preview.
  const openReceipt = useCallback(async (inv: Invoice) => {
    const base = { vendor: inv.vendor_name, amount: Number(inv.amount) };
    if (inv.attachment_storage_path) {
      setReceipt({ ...base, loading: true });
      const supabase = (await import("@/lib/supabase/client")).createClient();
      for (const bucket of ["field-captures", "email-attachments", "project-files"] as const) {
        const { data } = await supabase.storage.from(bucket).createSignedUrl(inv.attachment_storage_path, 3600);
        if (data?.signedUrl) {
          setReceipt({
            ...base,
            loading: false,
            url: data.signedUrl,
            isPdf: inv.attachment_storage_path.toLowerCase().endsWith(".pdf"),
          });
          return;
        }
      }
      setReceipt({ ...base, loading: false, missing: true });
    } else if (inv.drive_url) {
      setReceipt({ ...base, loading: false, driveUrl: inv.drive_url.replace(/\/view(\?[^/]*)?$/, "/preview") });
    } else {
      setReceipt({ ...base, loading: false, missing: true });
    }
  }, []);

  // Every real line an invoice or a worker's hours can be moved onto.
  const moveTargets = useMemo(
    () =>
      budgetVsActual
        .filter((l) => !l.is_section_header)
        .map((l) => ({ id: l.line_item_id, description: l.description })),
    [budgetVsActual],
  );

  const handleMoveInvoice = useCallback(
    async (invoiceId: string, toLineItemId: string) => {
      setMovingKey(`inv:${invoiceId}`);
      try {
        const res = await moveInvoiceToLine(invoiceId, toLineItemId);
        if (res.error) console.error("Move invoice failed:", res.error);
        router.refresh();
      } finally {
        setMovingKey(null);
      }
    },
    [router],
  );

  const handleMoveWorker = useCallback(
    async (profileId: string, fromLineItemId: string, toLineItemId: string) => {
      setMovingKey(`labor:${fromLineItemId}:${profileId}`);
      try {
        const res = await moveWorkerHours(projectId, profileId, fromLineItemId, toLineItemId);
        if (res.error) console.error("Move hours failed:", res.error);
        router.refresh();
      } finally {
        setMovingKey(null);
      }
    },
    [projectId, router],
  );

  // Clocked crew labor per line item id
  const laborByLineId = useMemo(() => {
    const map = new Map<string, LaborLineRow>();
    for (const row of laborByLine) {
      if (row.lineItemId) map.set(row.lineItemId, row);
    }
    return map;
  }, [laborByLine]);

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
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15">
          <TrendingUp className="h-4.5 w-4.5 text-sky-500" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Line Item Lifecycle</h3>
          <p className="text-xs text-muted-foreground">Estimate → Quotes → Schedule → Actuals → Profit</p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{invoices.length} invoices</span>
      </div>
      <div className="divide-y divide-border/50">
        {budgetVsActual.map((line) => {
          // Section headers (ELECTRICAL, KITCHEN, ...) are the estimate's
          // organizational rows — the contract math has always skipped them.
          // Render as dividers, not $0 money lines.
          if (line.is_section_header) {
            return (
              <div key={line.line_item_id} className="px-4 pt-4 pb-1.5 bg-muted/10">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {line.description}
                </span>
              </div>
            );
          }
          const isExpanded = expandedLine === line.line_item_id;
          const lineInvoices = invoicesByLine.byLine.get(line.line_item_id) || [];
          const lineQuotes = quotesByLine.get(line.line_item_id) || [];
          const linePhases = phasesByLine.get(line.line_item_id) || [];

          // Actual = invoices linked to the line + clocked crew labor costed to it.
          const lineLabor = laborByLineId.get(line.line_item_id) ?? null;
          const laborDollars = lineLabor ? lineLabor.cents / 100 : 0;
          const lineActual = Number(line.actual_invoiced || 0) + laborDollars;
          const budgetCost = Number(line.budgeted_cost || 0);
          const over = lineActual > budgetCost;
          const pct = budgetCost > 0 ? (lineActual / budgetCost) * 100 : lineActual > 0 ? 100 : 0;

          const hasDetails = lineInvoices.length > 0 || lineQuotes.length > 0 || linePhases.length > 0 || laborDollars > 0;

          // Lifecycle stage indicators
          const hasEstimate = true; // always true if it's in budget_vs_actual
          const hasQuotes = lineQuotes.length > 0;
          const hasSchedule = linePhases.length > 0;
          const hasActuals = lineInvoices.length > 0 || laborDollars > 0;

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
                    {line.is_locked && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground shrink-0"
                        title={line.closed_at ? `Closed ${new Date(line.closed_at).toLocaleDateString()}` : "Closed"}
                      >
                        <Lock className="h-2.5 w-2.5" />
                        CLOSED
                      </span>
                    )}
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
                    const profit = lineActual > 0
                      ? clientPrice - lineActual
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
                          <span className={`text-sm font-bold tabular-nums ${over ? "text-red-500" : lineActual > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                            {formatCurrency(lineActual)}
                          </span>
                          <span className="text-xs text-muted-foreground"> / {formatCurrency(budgetCost)}</span>
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
                      {formatCurrency(Math.abs(lineActual - budgetCost))} over
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

                  {/* Crew labor (clocked hours costed to this line, per person) */}
                  {laborDollars > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <HardHat className="h-3 w-3 text-red-400" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400">
                          Crew Labor ({formatHours(lineLabor?.hours ?? 0)})
                        </span>
                      </div>
                      {(lineLabor?.workers ?? []).map((w) => (
                        <div key={w.profileId} className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-500/5 text-xs mb-1">
                          <span className="flex-1 font-medium truncate">{w.name}</span>
                          <span className="text-muted-foreground">
                            {formatHours(w.hours)}
                            {w.rate != null ? ` @ $${w.rate.toFixed(0)}/hr` : ""}
                          </span>
                          <span className="font-semibold text-red-400 tabular-nums">
                            {w.cents != null ? formatCurrency(w.cents / 100) : "—"}
                          </span>
                          <MoveToLineMenu
                            targets={moveTargets}
                            excludeId={line.line_item_id}
                            disabled={movingKey === `labor:${line.line_item_id}:${w.profileId}`}
                            onPick={(to) => handleMoveWorker(w.profileId, line.line_item_id, to)}
                          />
                        </div>
                      ))}
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-500/10 text-xs border border-red-500/20">
                        <span className="flex-1 font-medium">Total clocked</span>
                        <span className="text-muted-foreground">{formatHours(lineLabor?.hours ?? 0)}</span>
                        <span className="font-semibold text-red-400 tabular-nums">{formatCurrency(laborDollars)}</span>
                      </div>
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
                        <div
                          key={inv.id}
                          onClick={() => openReceipt(inv)}
                          title="View receipt"
                          className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-500/5 hover:bg-red-500/15 cursor-pointer transition-colors text-xs mb-1"
                        >
                          <span className="flex-1 font-medium truncate">{inv.vendor_name}</span>
                          {inv.invoice_number && <span className="text-muted-foreground">#{inv.invoice_number}</span>}
                          {inv.invoice_date && <span className="text-muted-foreground">{inv.invoice_date}</span>}
                          <Badge variant="outline" className={`text-[8px] ${
                            inv.payment_status === "paid" ? "bg-green-500/15 text-green-500 border-green-500/30" :
                            "bg-red-500/15 text-red-500 border-red-500/30"
                          }`}>
                            {inv.payment_status === "paid" ? "Paid" : "Unpaid"}
                          </Badge>
                          {inv.drive_url && (
                            <a
                              href={inv.drive_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 hover:underline shrink-0"
                              title="View receipt"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Receipt
                            </a>
                          )}
                          <span className="font-semibold text-red-400 tabular-nums">{formatCurrency(Number(inv.amount))}</span>
                          <MoveToLineMenu
                            targets={moveTargets}
                            excludeId={line.line_item_id}
                            disabled={movingKey === `inv:${inv.id}`}
                            onPick={(to) => handleMoveInvoice(inv.id, to)}
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); setSplitInv({ id: inv.id, vendor: inv.vendor_name, amount: Number(inv.amount) }); }}
                            className="p-1 rounded hover:bg-muted text-amber-400/80 hover:text-amber-400 transition-colors shrink-0"
                            title="Split across budget lines"
                          >
                            <Split className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Profit summary when there are actuals */}
                  {(lineInvoices.length > 0 || laborDollars > 0) && (() => {
                    const clientPrice = Number(line.budgeted_price || 0);
                    const realProfit = clientPrice - lineActual;
                    const realMargin = clientPrice > 0 ? (realProfit / clientPrice) * 100 : 0;
                    return (
                      <div className="flex flex-wrap items-center gap-4 px-3 py-2 rounded bg-muted/30 text-xs border border-dashed">
                        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground font-medium">Bottom Line:</span>
                        <span className="text-foreground tabular-nums">Charged {formatCurrency(clientPrice)}</span>
                        <span className="text-red-400 tabular-nums">Spent {formatCurrency(lineActual)}</span>
                        <span className={`font-bold tabular-nums ${realProfit >= 0 ? "text-green-500" : "text-red-500"}`}>
                          Profit {formatCurrency(realProfit)} ({realMargin.toFixed(1)}%)
                        </span>
                        <LineLockButton
                          lineItemId={line.line_item_id}
                          projectId={projectId}
                          isLocked={Boolean(line.is_locked)}
                          closedAt={line.closed_at ?? null}
                          closedMargin={line.closed_margin ?? null}
                          liveMargin={realProfit}
                        />
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
                  <div
                    key={inv.id}
                    onClick={() => openReceipt(inv)}
                    title="View receipt"
                    className="flex items-center gap-2 px-3 py-1.5 rounded bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors text-xs"
                  >
                    <span className="flex-1 font-medium truncate">{inv.vendor_name}</span>
                    {inv.trade && <Badge variant="secondary" className="text-[8px]">{inv.trade}</Badge>}
                    {inv.invoice_date && <span className="text-muted-foreground">{inv.invoice_date}</span>}
                    <Badge variant="outline" className={`text-[8px] ${
                      inv.payment_status === "paid" ? "bg-green-500/15 text-green-500 border-green-500/30" :
                      "bg-red-500/15 text-red-500 border-red-500/30"
                    }`}>
                      {inv.payment_status === "paid" ? "Paid" : "Unpaid"}
                    </Badge>
                    {inv.drive_url && (
                      <a
                        href={inv.drive_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 hover:underline shrink-0"
                        title="View receipt"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Receipt
                      </a>
                    )}
                    <span className="font-semibold text-red-400 tabular-nums">{formatCurrency(Number(inv.amount))}</span>
                    <MoveToLineMenu
                      targets={moveTargets}
                      disabled={movingKey === `inv:${inv.id}`}
                      onPick={(to) => handleMoveInvoice(inv.id, to)}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); setSplitInv({ id: inv.id, vendor: inv.vendor_name, amount: Number(inv.amount) }); }}
                      className="p-1 rounded hover:bg-muted text-amber-400/80 hover:text-amber-400 transition-colors shrink-0"
                      title="Split across budget lines"
                    >
                      <Split className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Receipt picture lightbox */}
      {receipt && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setReceipt(null)}
        >
          <div className="relative flex flex-col items-center max-w-[92vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center w-full mb-2 gap-3 text-sm text-white/90">
              <span className="font-semibold truncate">{receipt.vendor}</span>
              <span className="tabular-nums text-white/70">{formatCurrency(receipt.amount)}</span>
              <span className="ml-auto flex items-center gap-3">
                {receipt.url && (
                  <a
                    href={receipt.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Full size
                  </a>
                )}
                <button onClick={() => setReceipt(null)} className="p-1 rounded hover:bg-white/10" title="Close">
                  <X className="h-5 w-5 text-white" />
                </button>
              </span>
            </div>
            {receipt.loading ? (
              <div className="flex items-center gap-2 text-white/80 text-sm py-16 px-24">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading receipt…
              </div>
            ) : receipt.missing ? (
              <div className="text-white/70 text-sm py-16 px-24">No picture on file for this invoice.</div>
            ) : receipt.driveUrl ? (
              <iframe src={receipt.driveUrl} className="w-[90vw] max-w-3xl h-[80vh] rounded-lg bg-white" title="Receipt" />
            ) : receipt.isPdf ? (
              <iframe src={receipt.url} className="w-[90vw] max-w-3xl h-[80vh] rounded-lg bg-white" title="Receipt PDF" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={receipt.url} alt="Receipt" className="max-h-[80vh] max-w-[92vw] rounded-lg object-contain" />
            )}
          </div>
        </div>
      )}

      {/* Split an invoice across budget lines (same dialog as the Invoices tab) */}
      {splitInv && (
        <InvoiceSplitDialog
          invoiceId={splitInv.id}
          projectId={projectId}
          vendorName={splitInv.vendor}
          invoiceAmount={splitInv.amount}
          onClose={() => setSplitInv(null)}
          onComplete={() => {
            setSplitInv(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

// ── Close out & lock a budget line ────────────────────
//
// Locking is enforced by DB triggers (migration 00126) on invoices and
// schedule_phases, not here -- cost reaches a line from ~37 call sites plus
// ad-hoc SQL. This button only flips the flag and snapshots the margin.
function LineLockButton({
  lineItemId,
  projectId,
  isLocked,
  closedAt,
  closedMargin,
  liveMargin,
}: {
  lineItemId: string;
  projectId: string;
  isLocked: boolean;
  closedAt: string | null;
  closedMargin: number | null;
  liveMargin: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cost that landed after the line was closed -- worth surfacing, since the
  // whole point of locking is that this shouldn't happen.
  const drifted =
    isLocked && closedMargin !== null && Math.abs(closedMargin - liveMargin) > 0.01;

  const run = async (fn: () => Promise<{ error?: string }>) => {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (res?.error) setError(res.error);
    else router.refresh();
  };

  return (
    <div className="ml-auto flex items-center gap-2">
      {error && <span className="text-[10px] text-red-500">{error}</span>}
      {drifted && (
        <span className="text-[10px] text-amber-400" title="Cost moved after this line was closed">
          closed at {formatCurrency(closedMargin!)}
        </span>
      )}
      {isLocked && closedAt && (
        <span className="text-[10px] text-muted-foreground">
          closed {new Date(closedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          run(() =>
            isLocked
              ? reopenLineItem(lineItemId, projectId)
              : closeLineItem(lineItemId, projectId),
          );
        }}
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors disabled:opacity-50 ${
          isLocked
            ? "bg-muted hover:bg-muted/70 text-muted-foreground"
            : "bg-green-500/15 hover:bg-green-500/25 text-green-500"
        }`}
      >
        {isLocked ? <LockOpen className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
        {busy ? "…" : isLocked ? "Unlock" : "Close out & lock"}
      </button>
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
      className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
    >
      <CheckCircle2 className="h-3 w-3" />
      {saving ? "Approving..." : "Approve"}
    </button>
  );
}

function PushCOToQBButton({ co, projectId }: { co: ChangeOrderRow; projectId: string }) {
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState(Boolean(co.quickbooks_pushed_at));
  const [error, setError] = useState<string | null>(null);

  if (pushed) {
    return (
      <span
        className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium text-green-500/80"
        title="Already on the QuickBooks estimate"
      >
        <CheckCircle2 className="h-3 w-3" /> In QB
      </span>
    );
  }

  async function handlePush() {
    setPushing(true);
    setError(null);
    const result = await pushChangeOrderToQB(co.id, projectId);
    setPushing(false);
    if (result.error) setError(result.error);
    else setPushed(true);
  }

  return (
    <>
      <button
        onClick={handlePush}
        disabled={pushing}
        title="Appends this CO as a line on the job's QuickBooks estimate"
        className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-colors disabled:opacity-50"
      >
        <Receipt className="h-3 w-3" />
        {pushing ? "Pushing..." : "Push to QB"}
      </button>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </>
  );
}

function EditCOButton({ co }: { co: ChangeOrderRow }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(co.title);
  const [description, setDescription] = useState(co.description ?? "");
  const [costImpact, setCostImpact] = useState(String(co.cost_impact));
  const [priceImpact, setPriceImpact] = useState(String(co.price_impact));
  const router = useRouter();

  function handleOpen() {
    setTitle(co.title);
    setDescription(co.description ?? "");
    setCostImpact(String(co.cost_impact));
    setPriceImpact(String(co.price_impact));
    setOpen(true);
  }

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    const supabase = (await import("@/lib/supabase/client")).createClient();
    await supabase.from("change_orders").update({
      title: title.trim(),
      description: description.trim() || null,
      cost_impact: Number(costImpact) || 0,
      price_impact: Number(priceImpact) || 0,
    }).eq("id", co.id);
    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium hover:bg-muted transition-colors"
      >
        <Pencil className="h-3 w-3" /> Edit
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-xl border shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Edit CO #{co.change_order_number}</h3>
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
                    step="0.01"
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
                    step="0.01"
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
                onClick={handleSave}
                disabled={saving || !title.trim()}
                className="px-4 py-2 rounded-md text-sm font-medium bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
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
        className={`shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium border transition-colors disabled:opacity-50 ${
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

function SendCOButton({ changeOrderId, coNumber, sentAt }: { changeOrderId: string; coNumber: number; sentAt: string | null }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

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
    if (data.success) router.refresh();
    else setError(data.error || "Failed");
  }

  if (sentAt) return (
    <>
      <span className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        <CheckCircle2 className="h-3 w-3" />
        Sent to client {new Date(sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
      </span>
      <button
        onClick={handleSend}
        disabled={sending}
        className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
        title="Resends PDF + approval link to client, CCs Ryan, Nicole & Jorge"
      >
        <Send className="h-3 w-3" />
        {sending ? "Sending..." : "Resend"}
      </button>
      {error && <span className="text-[9px] text-red-400 shrink-0">{error}</span>}
    </>
  );

  return (
    <>
      <button
        onClick={handleSend}
        disabled={sending}
        className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
        title="Sends PDF + approval link to client, CCs Ryan, Nicole & Jorge"
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
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleCreate() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const result = await createChangeOrder({
        project_id: projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        cost_impact: Number(costImpact) || 0,
        price_impact: Number(priceImpact) || 0,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setTitle("");
      setDescription("");
      setCostImpact("");
      setPriceImpact("");
      router.refresh();
    } catch {
      setError("Something went wrong — the change order was not created.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-orange-500/40 text-xs font-medium text-orange-400 transition-colors hover:bg-orange-500/10 active:scale-[0.99]"
      >
        <Plus className="h-3.5 w-3.5" />
        New Change Order
      </button>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <BottomSheetContent>
          <BottomSheetHeader>
            <BottomSheetTitle className="flex items-center gap-2">
              <FileWarning className="h-4 w-4 text-orange-400" />
              New Change Order
            </BottomSheetTitle>
            <BottomSheetDescription>
              Track a scope or budget change — send it to the client for approval after.
            </BottomSheetDescription>
          </BottomSheetHeader>
          <BottomSheetBody className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Extra framing for header"
                className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detailed scope of the change..."
                rows={3}
                className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm resize-none"
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
                  className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Client Price ($)</label>
                <input
                  type="number"
                  value={priceImpact}
                  onChange={(e) => setPriceImpact(e.target.value)}
                  placeholder="0"
                  className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm"
                />
              </div>
            </div>
          </BottomSheetBody>
          <BottomSheetFooter>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              onClick={handleCreate}
              disabled={saving || !title.trim()}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create Change Order"}
            </button>
          </BottomSheetFooter>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}

// ── Client invoice sub-components ──────────────────────

function TestSendInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<"idle" | "ok" | "err">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleTest() {
    setSending(true);
    setError(null);
    setResult("idle");
    try {
      const res = await fetch("/api/send-client-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, testOnly: true }),
      });
      const data = await res.json();
      if (data.success) {
        setResult("ok");
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
        className={`shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium border transition-colors disabled:opacity-50 ${
          result === "ok"
            ? "border-green-500/30 text-green-400 bg-green-500/10"
            : "border-border text-muted-foreground hover:bg-muted"
        }`}
        title="Email the invoice PDF to yourself only. Client doesn't receive anything."
      >
        <Mail className="h-3 w-3" />
        {sending ? "Sending..." : result === "ok" ? "Sent to you" : "Test Send"}
      </button>
      {error && <span className="text-[9px] text-red-400 shrink-0">{error}</span>}
    </>
  );
}

function SendInvoiceButton({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [ccLine, setCcLine] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const router = useRouter();

  async function handleOpen() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/send-client-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, preview: true }),
      });
      const data = await res.json();
      if (data.success) {
        setTo(data.to || "");
        setCcLine(data.cc || "");
        setSubject(data.subject || "");
        setBody(data.body || "");
        setAttachmentName(data.attachmentName || "");
        setOpen(true);
      } else {
        setError(data.error || "Could not load email preview");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
    setLoading(false);
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    const res = await fetch("/api/send-client-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId, clientEmail: to.trim(), cc: ccLine.trim(), subject, body }),
    });
    const data = await res.json();
    setSending(false);
    if (data.success) {
      setSent(true);
      setOpen(false);
      router.refresh();
    } else {
      setError(data.error || "Failed");
    }
  }

  if (sent) return (
    <span className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium text-emerald-400">
      Sent
    </span>
  );

  return (
    <>
      <button
        onClick={handleOpen}
        disabled={loading}
        className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
        title="Review and edit the email before it goes to the client, CCs Ryan"
      >
        <Send className="h-3 w-3" />
        {loading ? "Loading..." : "Send to Client"}
      </button>
      {error && !open && <span className="text-[9px] text-red-400 shrink-0" title={`Invoice #${invoiceNumber}`}>{error}</span>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !sending && setOpen(false)}>
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <h3 className="text-sm font-semibold text-zinc-100">Send Invoice #{invoiceNumber}</h3>
              <button onClick={() => !sending && setOpen(false)} className="text-zinc-400 hover:text-zinc-200">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 overflow-y-auto px-4 py-3">
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">To</label>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">Cc</label>
                <input
                  value={ccLine}
                  onChange={(e) => setCcLine(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div className="text-[10px] text-zinc-500">Attached: {attachmentName}</div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">Body</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs leading-relaxed text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
              {error && <p className="text-[10px] text-red-400">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
              <button
                onClick={() => setOpen(false)}
                disabled={sending}
                className="h-8 rounded-lg border border-zinc-700 px-3 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !to.trim()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
              >
                <Send className="h-3 w-3" />
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MarkInvoicePaidButton({ invoiceId, projectId }: { invoiceId: string; projectId: string }) {
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handlePaid() {
    setSaving(true);
    await markClientInvoicePaid(invoiceId, projectId);
    setSaving(false);
    router.refresh();
  }

  return (
    <button
      onClick={handlePaid}
      disabled={saving}
      className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
    >
      <CheckCircle2 className="h-3 w-3" />
      {saving ? "Saving..." : "Mark Paid"}
    </button>
  );
}

function CreateInQuickBooksButton({
  invoiceId,
  projectId,
  qbInvoiceId,
  qbDocNumber,
}: {
  invoiceId: string;
  projectId: string;
  qbInvoiceId: string | null;
  qbDocNumber: string | null;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (qbInvoiceId) {
    return (
      <span
        className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium text-green-400"
        title="Already in QuickBooks"
      >
        <CheckCircle2 className="h-3 w-3" />
        {qbDocNumber ? `QB · ${qbDocNumber}` : "In QuickBooks"}
      </span>
    );
  }

  async function handlePush() {
    setSaving(true);
    setError(null);
    const res = await syncClientInvoiceToQuickBooks(invoiceId, projectId);
    setSaving(false);
    if (res.error) {
      setError(res.error);
    } else {
      router.refresh();
    }
  }

  return (
    <>
      <button
        onClick={handlePush}
        disabled={saving}
        className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50"
        title="Creates this invoice in QuickBooks on the project's job (Const. Draw item)"
      >
        <Receipt className="h-3 w-3" />
        {saving ? "Creating..." : "Create in QuickBooks"}
      </button>
      {error && <span className="text-[9px] text-red-400 shrink-0">{error}</span>}
    </>
  );
}

function DeleteInvoiceButton({ invoiceId, projectId, invoiceNumber }: { invoiceId: string; projectId: string; invoiceNumber: number }) {
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    await deleteClientInvoice(invoiceId, projectId);
    setConfirming(false);
    router.refresh();
  }

  if (confirming) return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-red-400">Delete Invoice #{invoiceNumber}?</span>
      <button onClick={handleDelete} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30">Yes</button>
      <button onClick={() => setConfirming(false)} className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-muted">No</button>
    </div>
  );

  return (
    <button
      onClick={() => setConfirming(true)}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
    >
      <Trash2 className="h-3 w-3" /> Delete
    </button>
  );
}

function ClientInvoiceDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [terms, setTerms] = useState("Due on receipt");
  const [lines, setLines] = useState<{ description: string; amount: string }[]>([
    { description: "", amount: "" },
  ]);
  const router = useRouter();

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  function updateLine(idx: number, field: "description" | "amount", value: string) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { description: "", amount: "" }]);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  }

  async function handleCreate() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    const line_items = lines
      .filter((l) => l.description.trim())
      .map((l) => ({ description: l.description.trim(), amount: Number(l.amount) || 0 }));
    const res = await createClientInvoice({
      project_id: projectId,
      title: title.trim(),
      line_items,
      terms: terms.trim() || "Due on receipt",
    });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setTitle("");
    setTerms("Due on receipt");
    setLines([{ description: "", amount: "" }]);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-emerald-500/40 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10 active:scale-[0.99]"
      >
        <Plus className="h-3.5 w-3.5" />
        New Invoice
      </button>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <BottomSheetContent>
          <BottomSheetHeader>
            <BottomSheetTitle className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-emerald-400" />
              New Client Invoice
            </BottomSheetTitle>
            <BottomSheetDescription>
              Itemize what the client owes — branded PDF, one-click send.
            </BottomSheetDescription>
          </BottomSheetHeader>
          <BottomSheetBody className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Final Invoice — Window Project"
                className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Line Items</label>
              <div className="space-y-2 mt-1">
                {lines.map((l, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      value={l.description}
                      onChange={(e) => updateLine(idx, "description", e.target.value)}
                      placeholder="Description (e.g. Window replacement)"
                      className="flex-1 min-w-0 px-3 py-2 rounded-xl border bg-background text-sm"
                    />
                    <input
                      type="number"
                      value={l.amount}
                      onChange={(e) => updateLine(idx, "amount", e.target.value)}
                      placeholder="$"
                      className="w-24 px-3 py-2 rounded-xl border bg-background text-sm"
                    />
                    <button
                      onClick={() => removeLine(idx)}
                      className="text-muted-foreground hover:text-red-400 p-1 disabled:opacity-30"
                      disabled={lines.length === 1}
                      title="Remove line"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={addLine}
                className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
              >
                <Plus className="h-3 w-3" /> Add line
              </button>
            </div>
            <div className="flex items-center justify-between px-1 pt-1 border-t">
              <span className="text-xs font-medium text-muted-foreground">Total</span>
              <span className="text-base font-bold text-emerald-400 tabular-nums">{formatCurrency(total)}</span>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Payment Terms</label>
              <input
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="Due on receipt"
                className="w-full mt-1 px-3 py-2 rounded-xl border bg-background text-sm"
              />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </BottomSheetBody>
          <BottomSheetFooter>
            <button
              onClick={handleCreate}
              disabled={saving || !title.trim()}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create Invoice"}
            </button>
          </BottomSheetFooter>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}

function StatTile({
  icon: Icon, chipClass, value, valueClass = "", label, sub, jumpTo,
}: {
  icon: React.ComponentType<{ className?: string }>;
  chipClass: string; value: string; valueClass?: string; label: string; sub: string;
  jumpTo?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${chipClass}`}>
          <Icon className="h-3 w-3" />
        </span>
        <span className="truncate text-[11px] text-muted-foreground">{label}</span>
        {jumpTo && <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/50" />}
      </div>
      <div className={`mt-1 truncate text-base font-bold tabular-nums ${valueClass}`}>{value}</div>
      <div className="truncate text-[10px] text-muted-foreground/70">{sub}</div>
    </>
  );
  if (jumpTo) {
    return (
      <button
        type="button"
        onClick={() => document.getElementById(jumpTo)?.scrollIntoView({ behavior: "smooth", block: "start" })}
        className="rounded-xl border bg-card p-2.5 text-left shadow-sm transition-colors hover:bg-muted/40 active:scale-[0.98]"
      >
        {body}
      </button>
    );
  }
  return <div className="rounded-xl border bg-card p-2.5 shadow-sm">{body}</div>;
}

function Section({
  title, subtitle, icon: Icon, iconColorClass = "bg-muted text-muted-foreground", badge, total, totalColor = "text-red-400", children, id,
}: {
  title: string; subtitle: string; icon: React.ComponentType<{ className?: string }>;
  iconColorClass?: string; badge: string; total: number; totalColor?: string; children: React.ReactNode; id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-20 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconColorClass}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Badge variant="secondary" className="text-[10px] tabular-nums">{badge}</Badge>
        <span className={`shrink-0 text-sm font-bold tabular-nums ${totalColor}`}>{formatCurrency(total)}</span>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function BackToTopButton() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
      className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,1rem))] right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border bg-card/90 text-foreground shadow-lg backdrop-blur transition-transform hover:scale-105 active:scale-95 md:bottom-24 md:right-6"
    >
      <ArrowUp className="h-5 w-5" />
    </button>
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
