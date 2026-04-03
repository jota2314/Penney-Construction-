"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  HardHat,
  Users,
  Receipt,
  Clock,
  FileWarning,
  ShieldCheck,
  CircleDollarSign,
  Wallet,
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
  // ── Labor (actual — hours already worked) ──
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

  // ── Sub costs: committed vs actual vs change orders ──
  const subData = useMemo(() => {
    // Change orders = quotes with document_type containing "change_order" or "change order"
    const changeOrders = quoteRequests.filter(q => {
      const dt = (q.document_type || "").toLowerCase().replace(/[_-]/g, " ");
      return dt.includes("change order");
    });
    const changeOrderTotal = changeOrders.reduce((sum, q) => sum + (Number(q.amount) || 0), 0);

    // Regular quotes (not change orders)
    const regularQuotes = quoteRequests.filter(q => {
      const dt = (q.document_type || "").toLowerCase().replace(/[_-]/g, " ");
      return !dt.includes("change order");
    });

    // Committed = approved quotes (full amount — we're gonna pay it all)
    const committed = regularQuotes.filter(q => q.status === "approved");
    const committedTotal = committed.reduce((sum, q) => sum + (Number(q.amount) || 0), 0);

    // Pending = still waiting on quotes
    const pending = regularQuotes.filter(q =>
      q.status === "just_sent" || q.status === "awaiting_reply" || q.status === "in_progress" || q.status === "received"
    );
    const pendingTotal = pending.reduce((sum, q) => sum + (Number(q.amount) || 0), 0);

    return { committed, committedTotal, pending, pendingTotal, changeOrders, changeOrderTotal };
  }, [quoteRequests]);

  // ── Vendor invoices paid (actual sub spend — money out the door) ──
  const vendorInvoiceData = useMemo(() => {
    // Vendor invoices = invoices to subs/suppliers (not client invoices)
    const vendorInvoices = invoices.filter(i =>
      i.vendor_type === "subcontractor" || i.vendor_type === "supplier" || i.vendor_type === "vendor"
    );
    const totalPaid = vendorInvoices.reduce((sum, i) => sum + (Number(i.paid_amount) || 0), 0);
    const totalInvoiced = vendorInvoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    return { vendorInvoices, totalPaid, totalInvoiced };
  }, [invoices]);

  // ── Client invoices (income / earnings) ──
  const incomeData = useMemo(() => {
    // Client invoices = "other" vendor_type or we treat all non-vendor invoices as client
    // Actually, invoices in this system can be from vendors. Client billing may be separate.
    // For now, let's show all invoices and the user can categorize.
    const clientInvoices = invoices.filter(i => i.vendor_type === "other" || !i.vendor_type);
    const totalInvoiced = clientInvoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const totalPaid = clientInvoices.reduce((sum, i) => sum + (Number(i.paid_amount) || 0), 0);
    const outstanding = totalInvoiced - totalPaid;
    return { clientInvoices, totalInvoiced, totalPaid, outstanding };
  }, [invoices]);

  // ── Totals ──
  const latestEstimate = estimates.length > 0 ? estimates[0] : null;
  const originalBudget = contractValue || latestEstimate?.total_price || estimatedValue || 0;
  const adjustedBudget = originalBudget + subData.changeOrderTotal;

  // Committed = approved sub quotes (locked in, will be paid)
  const totalCommitted = subData.committedTotal;
  // Actual = labor already worked + vendor invoices already paid
  const totalActual = laborData.totalCost + vendorInvoiceData.totalPaid;
  // Total exposure = committed + actual (what we owe or have paid)
  const totalExposure = totalCommitted + totalActual;

  const profit = incomeData.totalPaid - totalExposure;
  const margin = incomeData.totalPaid > 0 ? (profit / incomeData.totalPaid) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* ── Top Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          label="Budget"
          value={formatCurrency(adjustedBudget || null)}
          sub={
            subData.changeOrderTotal > 0
              ? `${formatCurrency(originalBudget)} + ${formatCurrency(subData.changeOrderTotal)} CO`
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
          label="Actual"
          value={formatCurrency(totalActual)}
          sub="Labor + paid invoices"
          color="text-red-500"
        />
        <SummaryCard
          label="Change Orders"
          value={formatCurrency(subData.changeOrderTotal)}
          sub={`${subData.changeOrders.length} CO${subData.changeOrders.length !== 1 ? "s" : ""}`}
          color="text-orange-500"
        />
        <SummaryCard
          label="Income"
          value={formatCurrency(incomeData.totalPaid)}
          sub={incomeData.outstanding > 0 ? `${formatCurrency(incomeData.outstanding)} owed` : "All collected"}
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

      {/* ── Budget vs Committed + Actual Bar ── */}
      {adjustedBudget > 0 && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Budget Breakdown</span>
            <span className="text-muted-foreground">
              {formatCurrency(totalExposure)} of {formatCurrency(adjustedBudget)} (
              {((totalExposure / adjustedBudget) * 100).toFixed(0)}%)
            </span>
          </div>

          {/* Stacked bar: actual (solid) + committed (striped) */}
          <div className="w-full h-4 rounded-full bg-muted overflow-hidden relative">
            {/* Actual spend (solid) */}
            <div
              className="h-full bg-red-500 absolute left-0 top-0 transition-all"
              style={{ width: `${Math.min(100, (totalActual / adjustedBudget) * 100)}%` }}
            />
            {/* Committed (lighter, stacked after actual) */}
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
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500" />
              Actual: {formatCurrency(totalActual)}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500/60" />
              Committed: {formatCurrency(totalCommitted)}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-muted-foreground/20" />
              Remaining: {formatCurrency(Math.max(0, adjustedBudget - totalExposure))}
            </span>
            {subData.changeOrderTotal > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-orange-500" />
                Change Orders: +{formatCurrency(subData.changeOrderTotal)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Committed Costs (Approved Sub Quotes) ── */}
      <Section title="Committed" subtitle="Approved quotes — locked in" icon={ShieldCheck} badge={`${subData.committed.length} subs`} total={totalCommitted} totalColor="text-amber-500">
        {subData.committed.length === 0 ? (
          <EmptyState icon={Users} text="No approved quotes yet. Approve a sub quote to commit it as an expense." />
        ) : (
          <div className="space-y-1.5">
            {subData.committed.map((q) => (
              <div key={q.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{q.subcontractor_name || "Unknown Sub"}</span>
                  {q.trade && <Badge variant="secondary" className="text-[9px] ml-2">{q.trade}</Badge>}
                </div>
                <Badge variant="outline" className="text-[9px] bg-cyan-500/15 text-cyan-400 border-cyan-500/30 shrink-0">Approved</Badge>
                <span className="font-semibold text-amber-400 shrink-0">{formatCurrency(Number(q.amount))}</span>
              </div>
            ))}
          </div>
        )}

        {/* Pending quotes shown below committed */}
        {subData.pending.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
              Pending / Awaiting ({subData.pending.length})
            </div>
            {subData.pending.map((q) => (
              <div key={q.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/20 text-sm opacity-60">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{q.subcontractor_name || "Unknown Sub"}</span>
                  {q.trade && <Badge variant="secondary" className="text-[9px] ml-2">{q.trade}</Badge>}
                </div>
                <Badge variant="outline" className="text-[9px] shrink-0">Pending</Badge>
                <span className="font-medium text-muted-foreground shrink-0">
                  {q.amount ? formatCurrency(Number(q.amount)) : "TBD"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Actual Costs ── */}
      <Section title="Actual" subtitle="Money spent — labor + paid invoices" icon={Wallet} badge={formatCurrency(totalActual)} total={totalActual} totalColor="text-red-500">
        {/* Labor subsection */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
            <HardHat className="h-3 w-3" />
            Labor — {formatHours(laborData.totalHours)} logged
            <span className="ml-auto font-bold text-red-400 normal-case text-xs">{formatCurrency(laborData.totalCost)}</span>
          </div>
          {laborData.byEmployee.length === 0 ? (
            <div className="text-xs text-muted-foreground/60 px-3 py-2">No time entries logged yet.</div>
          ) : (
            laborData.byEmployee
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
              ))
          )}
        </div>

        {/* Vendor invoices subsection */}
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
            <Receipt className="h-3 w-3" />
            Vendor Invoices Paid
            <span className="ml-auto font-bold text-red-400 normal-case text-xs">{formatCurrency(vendorInvoiceData.totalPaid)}</span>
          </div>
          {vendorInvoiceData.vendorInvoices.length === 0 ? (
            <div className="text-xs text-muted-foreground/60 px-3 py-2">No vendor invoices yet.</div>
          ) : (
            vendorInvoiceData.vendorInvoices.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{inv.vendor_name}</span>
                  {inv.trade && <Badge variant="secondary" className="text-[9px] ml-2">{inv.trade}</Badge>}
                  {inv.invoice_number && (
                    <span className="text-xs text-muted-foreground ml-1">#{inv.invoice_number}</span>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={`text-[9px] shrink-0 ${
                    inv.payment_status === "paid"
                      ? "bg-green-500/15 text-green-500 border-green-500/30"
                      : "bg-amber-500/15 text-amber-500 border-amber-500/30"
                  }`}
                >
                  {inv.payment_status === "paid" ? "Paid" : "Partial"}
                </Badge>
                <span className="font-semibold text-red-400 shrink-0">{formatCurrency(Number(inv.paid_amount))}</span>
              </div>
            ))
          )}
        </div>
      </Section>

      {/* ── Change Orders ── */}
      {subData.changeOrders.length > 0 && (
        <Section title="Change Orders" subtitle="Budget adjustments" icon={FileWarning} badge={`${subData.changeOrders.length}`} total={subData.changeOrderTotal} totalColor="text-orange-500">
          <div className="space-y-1.5">
            {subData.changeOrders.map((co) => (
              <div key={co.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{co.subcontractor_name || co.scope_description || "Change Order"}</span>
                  {co.trade && <Badge variant="secondary" className="text-[9px] ml-2">{co.trade}</Badge>}
                  {co.scope_description && co.subcontractor_name && (
                    <span className="text-xs text-muted-foreground ml-2 truncate">{co.scope_description}</span>
                  )}
                </div>
                <Badge variant="outline" className={`text-[9px] shrink-0 ${
                  co.status === "approved"
                    ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
                    : "bg-orange-500/15 text-orange-500 border-orange-500/30"
                }`}>
                  {co.status === "approved" ? "Approved" : "Pending"}
                </Badge>
                <span className="font-semibold text-orange-400 shrink-0">+{formatCurrency(Number(co.amount))}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Client Invoices (Income / Earnings) ── */}
      <Section title="Income" subtitle="Client invoices & payments received" icon={CircleDollarSign} badge={`${invoices.length}`} total={incomeData.totalInvoiced} totalColor="text-green-500">
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
  subtitle,
  icon: Icon,
  badge,
  total,
  totalColor = "text-red-400",
  children,
}: {
  title: string;
  subtitle: string;
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
