"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  HardHat,
  Users,
  Receipt,
  Clock,
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

interface ProjectFinancesTabProps {
  estimates: Estimate[];
  quoteRequests: QuoteRequest[];
  invoices: Invoice[];
  timeEntries: TimeEntryWithEmployee[];
  contractValue: number | null;
  estimatedValue: number | null;
}

// ── Helpers ────────────────────────────────────────────

function hoursWorked(entry: TimeEntryWithEmployee): number {
  if (!entry.clock_out) return 0;
  const ms = new Date(entry.clock_out).getTime() - new Date(entry.clock_in).getTime();
  const totalMinutes = ms / 60000;
  const netMinutes = Math.max(0, totalMinutes - (entry.break_minutes || 0));
  return netMinutes / 60;
}

function formatHours(h: number): string {
  return h.toFixed(1) + "h";
}

// ── Component ──────────────────────────────────────────

export function ProjectFinancesTab({
  estimates,
  quoteRequests,
  invoices,
  timeEntries,
  contractValue,
  estimatedValue,
}: ProjectFinancesTabProps) {
  // ── Labor costs ──
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
        byEmployee.set(entry.employee_id, {
          name: entry.employee_name,
          hours: h,
          cost,
          rate: entry.hourly_rate,
        });
      }
    }

    return { totalHours, totalCost, byEmployee: Array.from(byEmployee.values()) };
  }, [timeEntries]);

  // ── Sub costs (approved quotes = committed expenses) ──
  const subData = useMemo(() => {
    const approved = quoteRequests.filter(q => q.status === "approved");
    const totalApproved = approved.reduce((sum, q) => sum + (Number(q.amount) || 0), 0);
    const pending = quoteRequests.filter(q => q.status === "just_sent" || q.status === "awaiting_reply" || q.status === "in_progress");
    const totalPending = pending.reduce((sum, q) => sum + (Number(q.amount) || 0), 0);
    return { approved, totalApproved, pending, totalPending };
  }, [quoteRequests]);

  // ── Invoices (income from client) ──
  const incomeData = useMemo(() => {
    const totalInvoiced = invoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const totalPaid = invoices.reduce((sum, i) => sum + (Number(i.paid_amount) || 0), 0);
    const outstanding = totalInvoiced - totalPaid;
    return { totalInvoiced, totalPaid, outstanding };
  }, [invoices]);

  // ── Budget ──
  const latestEstimate = estimates.length > 0 ? estimates[0] : null;
  const budget = contractValue || latestEstimate?.total_price || estimatedValue || 0;
  const totalCosts = laborData.totalCost + subData.totalApproved;
  const profit = incomeData.totalPaid - totalCosts;
  const margin = incomeData.totalPaid > 0 ? (profit / incomeData.totalPaid) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* ── Top-Level Summary ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          label="Budget"
          value={formatCurrency(budget || null)}
          sub={contractValue ? "Contract" : latestEstimate ? `Estimate v${latestEstimate.version}` : "Est. Value"}
          color="text-foreground"
        />
        <SummaryCard
          label="Total Costs"
          value={formatCurrency(totalCosts)}
          sub={`Labor + Subs`}
          color="text-red-500"
        />
        <SummaryCard
          label="Income (Paid)"
          value={formatCurrency(incomeData.totalPaid)}
          sub={incomeData.outstanding > 0 ? `${formatCurrency(incomeData.outstanding)} outstanding` : "All paid"}
          color="text-green-500"
        />
        <SummaryCard
          label="Profit"
          value={formatCurrency(profit)}
          sub={incomeData.totalPaid > 0 ? `${margin.toFixed(1)}% margin` : "No income yet"}
          color={profit >= 0 ? "text-green-500" : "text-red-500"}
          icon={profit >= 0 ? TrendingUp : TrendingDown}
        />
      </div>

      {/* ── Budget vs Actual Bar ── */}
      {budget > 0 && (
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Budget vs Actual Spend</span>
            <span className="text-muted-foreground">
              {formatCurrency(totalCosts)} of {formatCurrency(budget)} ({budget > 0 ? ((totalCosts / budget) * 100).toFixed(0) : 0}%)
            </span>
          </div>
          <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                totalCosts / budget > 0.9 ? "bg-red-500" : totalCosts / budget > 0.7 ? "bg-amber-500" : "bg-green-500"
              }`}
              style={{ width: `${Math.min(100, budget > 0 ? (totalCosts / budget) * 100 : 0)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Labor: {formatCurrency(laborData.totalCost)}</span>
            <span>Subs: {formatCurrency(subData.totalApproved)}</span>
            <span>Remaining: {formatCurrency(Math.max(0, budget - totalCosts))}</span>
          </div>
        </div>
      )}

      {/* ── Labor Costs ── */}
      <Section title="Labor Costs" icon={HardHat} badge={formatHours(laborData.totalHours)} total={laborData.totalCost}>
        {laborData.byEmployee.length === 0 ? (
          <EmptyState icon={Clock} text="No time entries logged for this project yet." />
        ) : (
          <div className="space-y-1.5">
            {laborData.byEmployee
              .sort((a, b) => b.cost - a.cost)
              .map((emp) => (
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

      {/* ── Subcontractor Costs ── */}
      <Section title="Subcontractor Costs" icon={Users} badge={`${subData.approved.length} approved`} total={subData.totalApproved}>
        {subData.approved.length === 0 && subData.pending.length === 0 ? (
          <EmptyState icon={Users} text="No sub quotes yet. Approved quotes become committed expenses." />
        ) : (
          <div className="space-y-1.5">
            {subData.approved.map((q) => (
              <div key={q.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{q.subcontractor_name || "Unknown Sub"}</span>
                  {q.trade && (
                    <Badge variant="secondary" className="text-[9px] ml-2">{q.trade}</Badge>
                  )}
                </div>
                <Badge variant="outline" className="text-[9px] bg-cyan-500/15 text-cyan-400 border-cyan-500/30 shrink-0">
                  Approved
                </Badge>
                <span className="font-semibold text-red-400 shrink-0">{formatCurrency(Number(q.amount))}</span>
              </div>
            ))}
            {subData.pending.length > 0 && (
              <>
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider pt-2 px-1">
                  Pending / Awaiting ({subData.pending.length})
                </div>
                {subData.pending.map((q) => (
                  <div key={q.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/20 text-sm opacity-60">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{q.subcontractor_name || "Unknown Sub"}</span>
                      {q.trade && (
                        <Badge variant="secondary" className="text-[9px] ml-2">{q.trade}</Badge>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[9px] shrink-0">Pending</Badge>
                    <span className="font-medium text-muted-foreground shrink-0">
                      {q.amount ? formatCurrency(Number(q.amount)) : "TBD"}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </Section>

      {/* ── Client Invoices (Income) ── */}
      <Section title="Client Invoices" icon={Receipt} badge={`${invoices.length}`} total={incomeData.totalInvoiced} totalColor="text-green-500">
        {invoices.length === 0 ? (
          <EmptyState icon={Receipt} text="No client invoices yet." />
        ) : (
          <div className="space-y-1.5">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">
                    {inv.description || inv.vendor_name || "Invoice"}
                    {inv.invoice_number && <span className="text-muted-foreground font-normal"> #{inv.invoice_number}</span>}
                  </span>
                  {inv.invoice_date && (
                    <span className="text-xs text-muted-foreground ml-2">{inv.invoice_date}</span>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={`text-[9px] shrink-0 ${
                    inv.payment_status === "paid"
                      ? "bg-green-500/15 text-green-500 border-green-500/30"
                      : inv.payment_status === "partial"
                      ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
                      : "bg-red-500/15 text-red-500 border-red-500/30"
                  }`}
                >
                  {inv.payment_status === "paid" ? "Paid" : inv.payment_status === "partial" ? "Partial" : "Unpaid"}
                </Badge>
                <span className="font-semibold text-green-500 shrink-0">{formatCurrency(Number(inv.amount))}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
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
  title,
  icon: Icon,
  badge,
  total,
  totalColor = "text-red-400",
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  badge: string;
  total: number;
  totalColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
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
