"use client";

import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  Receipt,
  Building2,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ProjectSummary {
  id: string;
  name: string;
  project_number: string;
  status: string;
  adjustedContract: number;
  totalSpent: number;
  totalReceived: number;
  outstanding: number;
  cashFlow: number;
  unpaidInvoices: number;
}

interface UnpaidInvoice {
  id: string;
  vendor_name: string;
  amount: number;
  due_date: string | null;
  trade: string | null;
  project_name: string;
}

interface CeoDashboardProps {
  totals: {
    totalContractValue: number;
    totalInvoiced: number;
    totalPaid: number;
    totalReceived: number;
    totalOutstanding: number;
    totalUnpaidInvoices: number;
    totalLaborCost: number;
    totalSpent: number;
    cashPosition: number;
    projectCount: number;
  };
  projects: ProjectSummary[];
  unpaidInvoices: UnpaidInvoice[];
  dailySpendRate: number;
  dailyEarnRate: number;
  laborHours30d: number;
  laborCost30d: number;
}

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

export function CeoDashboard({
  totals,
  projects,
  unpaidInvoices,
  dailySpendRate,
  dailyEarnRate,
  laborHours30d,
  laborCost30d,
}: CeoDashboardProps) {
  const netDailyRate = dailyEarnRate - dailySpendRate;

  return (
    <div className="space-y-6">
      {/* ── Live Totals ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <BigCard
          label="Total Contracts"
          value={fmt(totals.totalContractValue)}
          sub={`${totals.projectCount} active projects`}
          icon={Building2}
          color="text-foreground"
        />
        <BigCard
          label="Total Spent"
          value={fmt(totals.totalSpent)}
          sub={`${fmt(totals.totalUnpaidInvoices)} unpaid to subs`}
          icon={ArrowUpRight}
          color="text-red-500"
        />
        <BigCard
          label="Total Received"
          value={fmt(totals.totalReceived)}
          sub={`${fmt(totals.totalOutstanding)} owed by clients`}
          icon={ArrowDownRight}
          color="text-green-500"
        />
        <BigCard
          label="Cash Position"
          value={fmt(totals.cashPosition)}
          sub={totals.cashPosition >= 0 ? "Healthy" : "Negative — collect!"}
          icon={totals.cashPosition >= 0 ? TrendingUp : TrendingDown}
          color={totals.cashPosition >= 0 ? "text-green-500" : "text-red-500"}
        />
        <BigCard
          label="Gross Profit"
          value={fmt(totals.totalReceived - totals.totalSpent)}
          sub={totals.totalReceived > 0
            ? `${Math.round(((totals.totalReceived - totals.totalSpent) / totals.totalReceived) * 100)}% margin`
            : "No revenue yet"}
          icon={DollarSign}
          color={totals.totalReceived - totals.totalSpent >= 0 ? "text-green-500" : "text-red-500"}
        />
      </div>

      {/* ── Daily Rates ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <RateCard label="Daily Spend" value={fmt(dailySpendRate)} sub="/day (30d avg)" icon={ArrowUpRight} color="text-red-400" />
        <RateCard label="Daily Earn" value={fmt(dailyEarnRate)} sub="/day (30d avg)" icon={ArrowDownRight} color="text-green-400" />
        <RateCard
          label="Net Daily"
          value={fmt(netDailyRate)}
          sub={netDailyRate >= 0 ? "/day net positive" : "/day net BURN"}
          icon={netDailyRate >= 0 ? TrendingUp : TrendingDown}
          color={netDailyRate >= 0 ? "text-green-500" : "text-red-500"}
        />
        <RateCard label="Labor (30d)" value={`${laborHours30d}h`} sub={fmt(laborCost30d)} icon={Timer} color="text-amber-400" />
      </div>

      {/* ── Project Health ── */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Project Health</h3>
          <span className="ml-auto text-xs text-muted-foreground">{projects.length} active</span>
        </div>
        <div className="divide-y divide-border/50">
          {projects.map((p) => {
            const pctSpent = p.adjustedContract > 0 ? (p.totalSpent / p.adjustedContract) * 100 : 0;
            const pctCollected = p.adjustedContract > 0 ? (p.totalReceived / p.adjustedContract) * 100 : 0;
            const health = p.cashFlow >= 0 ? "good" : "warning";

            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors"
              >
                <div className={`h-2 w-2 rounded-full shrink-0 ${health === "good" ? "bg-green-500" : "bg-red-500"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground">{p.project_number}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    {/* Mini bar: spent vs collected */}
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden relative max-w-[200px]">
                      <div className="absolute left-0 top-0 h-full rounded-full bg-red-500/60" style={{ width: `${Math.min(pctSpent, 100)}%` }} />
                      <div className="absolute left-0 top-0 h-full rounded-full bg-green-500/60" style={{ width: `${Math.min(pctCollected, 100)}%` }} />
                    </div>
                    <span className="text-[9px] text-muted-foreground ml-1">
                      {Math.round(pctSpent)}% spent / {Math.round(pctCollected)}% collected
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold tabular-nums">{fmt(p.adjustedContract)}</div>
                  <div className={`text-[10px] font-medium ${p.cashFlow >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {p.cashFlow >= 0 ? "+" : ""}{fmt(p.cashFlow)} cash
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Upcoming: Invoices Due to Subs ── */}
      {unpaidInvoices.length > 0 && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b">
            <Receipt className="h-4 w-4 text-red-400" />
            <h3 className="text-sm font-semibold">Unpaid to Subs</h3>
            <Badge variant="secondary" className="text-[9px] ml-auto">{unpaidInvoices.length}</Badge>
            <span className="text-sm font-bold text-red-400">{fmt(unpaidInvoices.reduce((s, i) => s + i.amount, 0))}</span>
          </div>
          <div className="divide-y divide-border/50">
            {unpaidInvoices.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{inv.vendor_name}</span>
                  {inv.trade && <Badge variant="secondary" className="text-[8px] ml-2">{inv.trade}</Badge>}
                  <span className="text-[10px] text-muted-foreground ml-2">{inv.project_name}</span>
                </div>
                {inv.due_date && (
                  <span className="text-[10px] text-muted-foreground">{inv.due_date}</span>
                )}
                <span className="font-bold text-red-400 tabular-nums shrink-0">{fmt(inv.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Client Receivables ── */}
      {totals.totalOutstanding > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-amber-400">Owed by Clients</h3>
            <span className="ml-auto text-sm font-bold text-amber-400">{fmt(totals.totalOutstanding)}</span>
          </div>
          <div className="divide-y divide-amber-500/10">
            {projects.filter((p) => p.outstanding > 0).map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-amber-500/5 transition-colors"
              >
                <div>
                  <span className="font-medium">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">{p.project_number}</span>
                </div>
                <span className="font-bold text-amber-400 tabular-nums">{fmt(p.outstanding)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BigCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub: string; color: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

function RateCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub: string; color: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border bg-card p-3 flex items-center gap-3">
      <div className={`h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0`}>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div>
        <div className={`text-sm font-bold ${color}`}>{value}</div>
        <div className="text-[9px] text-muted-foreground">{label} {sub}</div>
      </div>
    </div>
  );
}
