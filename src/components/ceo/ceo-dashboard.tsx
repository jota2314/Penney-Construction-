"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSearchParamState } from "@/lib/hooks/use-search-param-state";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, ArrowUpRight, ArrowDownRight,
  Building2, Timer, FileText, Receipt, AlertTriangle, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

/* ── Types ── */

type Period = "all" | "year" | "month" | "week" | "daily";

interface PeriodTotals {
  spent: number;
  received: number;
}

interface LiveDaily {
  totalSpent: number;
  totalReceived: number;
  laborCost: number;
  invoiceSpend: number;
  clockedIn: number;
  clockedInNames: string[];
  serverTime: string;
}

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
  periods: Record<Period, PeriodTotals>;
  liveDaily: LiveDaily;
  estimatesSent: number;
  estimatesWon: number;
  estimatesTotal: number;
  projects: ProjectSummary[];
  unpaidInvoices: UnpaidInvoice[];
  dailySpendRate: number;
  dailyEarnRate: number;
  laborHours30d: number;
  laborCost30d: number;
  weeklyData: { week: string; spent: number; received: number }[];
  spendByTrade: { trade: string; amount: number }[];
  projectSpending: { name: string; contract: number; spent: number; received: number }[];
}

/* ── Formatting ── */

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

const TRADE_COLORS = [
  "#f59e0b", "#ef4444", "#8b5cf6", "#3b82f6", "#10b981",
  "#f97316", "#ec4899", "#06b6d4", "#84cc16", "#6366f1",
];

const PERIOD_LABELS: Record<Period, string> = {
  all: "All Time",
  year: "This Year",
  month: "This Month",
  week: "This Week",
  daily: "Today",
};

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload) return null;
  return (
    <div className="bg-card border rounded-lg px-3 py-2 shadow-xl text-xs">
      <div className="font-medium mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

/* ── Main Component ── */

export function CeoDashboard({
  totals, periods, liveDaily, estimatesSent, estimatesWon, estimatesTotal,
  projects, unpaidInvoices,
  dailySpendRate, dailyEarnRate, laborHours30d, laborCost30d,
  weeklyData, spendByTrade, projectSpending,
}: CeoDashboardProps) {
  const [period, setPeriod] = useSearchParamState("period", "all") as [Period, (v: string) => void];
  const router = useRouter();

  // Auto-refresh every 30s when on Daily (live mode)
  useEffect(() => {
    if (period !== "daily") return;
    const interval = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(interval);
  }, [period, router]);

  const activePeriod = periods[period];
  const periodProfit = activePeriod.received - activePeriod.spent;
  const periodMargin = activePeriod.received > 0 ? Math.round((periodProfit / activePeriod.received) * 100) : 0;
  const netDailyRate = dailyEarnRate - dailySpendRate;
  const isLive = period === "daily";

  return (
    <div className="space-y-6">
      {/* ── Period Toggle ── */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 bg-card border rounded-xl p-1">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                period === p
                  ? p === "daily"
                    ? "bg-green-600 text-white shadow-lg"
                    : "bg-amber-600 text-white shadow-lg"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {p === "daily" && <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-green-300" /></span>}
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        {isLive && (
          <span className="text-[10px] text-green-400 font-medium animate-pulse">
            LIVE — refreshes every 30s
          </span>
        )}
      </div>

      {/* ── Hero KPIs: Spent & Received ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* SPENT */}
        <div className={`rounded-2xl border p-6 sm:p-8 ${isLive ? "bg-card border-red-500/20" : "bg-card"}`}>
          <div className="flex items-center gap-2 mb-3">
            <div className="h-10 w-10 rounded-xl bg-red-500/10 flex items-center justify-center">
              <ArrowUpRight className="h-5 w-5 text-red-500" />
            </div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              {isLive ? "Today's Spend" : "Total Spent"}
            </span>
            {isLive && <LiveBadge />}
          </div>
          <div className="text-4xl sm:text-5xl lg:text-6xl font-black text-red-500 tabular-nums tracking-tight">
            {fmt(activePeriod.spent)}
          </div>
          {isLive ? (
            <div className="mt-3 space-y-1">
              {liveDaily.laborCost > 0 && (
                <div className="text-sm text-red-400/80">
                  <Users className="h-3.5 w-3.5 inline mr-1" />
                  {fmt(liveDaily.laborCost)} labor
                  {liveDaily.clockedIn > 0 && (
                    <span className="text-muted-foreground"> — {liveDaily.clockedIn} on the clock</span>
                  )}
                </div>
              )}
              {liveDaily.invoiceSpend > 0 && (
                <div className="text-sm text-red-400/80">
                  <Receipt className="h-3.5 w-3.5 inline mr-1" />
                  {fmt(liveDaily.invoiceSpend)} invoices
                </div>
              )}
              {liveDaily.totalSpent === 0 && (
                <div className="text-sm text-muted-foreground">No spend recorded yet today</div>
              )}
              <div className="text-xs text-muted-foreground mt-2">
                30d avg: {fmt(dailySpendRate)}/day
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground mt-2">
              {fmt(totals.totalUnpaidInvoices)} unpaid to subs
            </div>
          )}
        </div>

        {/* RECEIVED */}
        <div className={`rounded-2xl border p-6 sm:p-8 ${isLive ? "bg-card border-green-500/20" : "bg-card"}`}>
          <div className="flex items-center gap-2 mb-3">
            <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center">
              <ArrowDownRight className="h-5 w-5 text-green-500" />
            </div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              {isLive ? "Today's Received" : "Total Received"}
            </span>
            {isLive && <LiveBadge />}
          </div>
          <div className="text-4xl sm:text-5xl lg:text-6xl font-black text-green-500 tabular-nums tracking-tight">
            {fmt(activePeriod.received)}
          </div>
          {isLive ? (
            <div className="mt-3 space-y-1">
              {liveDaily.totalReceived > 0 ? (
                <div className="text-sm text-green-400/80">
                  <DollarSign className="h-3.5 w-3.5 inline mr-1" />
                  {fmt(liveDaily.totalReceived)} received today
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No payments received yet today</div>
              )}
              <div className="text-xs text-muted-foreground mt-2">
                30d avg: {fmt(dailyEarnRate)}/day
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground mt-2">
              {fmt(totals.totalOutstanding)} owed by clients
            </div>
          )}
        </div>
      </div>

      {/* ── Crew on the Clock (only in live mode) ── */}
      {isLive && liveDaily.clockedIn > 0 && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Users className="h-5 w-5 text-green-400" />
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
              </span>
            </div>
            <div>
              <span className="text-sm font-semibold text-green-400">{liveDaily.clockedIn} crew on the clock</span>
              <span className="text-xs text-muted-foreground ml-3">
                {liveDaily.clockedInNames.join(", ")}
              </span>
            </div>
            <span className="ml-auto text-sm font-bold text-green-400 tabular-nums">{fmt(liveDaily.laborCost)}</span>
          </div>
        </div>
      )}

      {/* ── Secondary KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Contracts"
          value={fmt(totals.totalContractValue)}
          sub={`${totals.projectCount} active`}
          icon={Building2}
          color="text-foreground"
        />
        <KpiCard
          label="Gross Profit"
          value={fmt(periodProfit)}
          sub={`${periodMargin}% margin`}
          icon={DollarSign}
          color={periodProfit >= 0 ? "text-green-500" : "text-red-500"}
        />
        <KpiCard
          label="Estimates"
          value={`${estimatesTotal}`}
          sub={`${estimatesWon} won · ${estimatesSent} sent`}
          icon={FileText}
          color="text-amber-400"
        />
        <KpiCard
          label="Labor (30d)"
          value={`${laborHours30d}h`}
          sub={fmt(laborCost30d)}
          icon={Timer}
          color="text-blue-400"
        />
      </div>

      {/* ── Daily Rates ── */}
      <div className="grid grid-cols-3 gap-3">
        <RateCard label="Daily Spend" value={fmt(dailySpendRate)} sub="30d avg" icon={ArrowUpRight} color="text-red-400" />
        <RateCard label="Daily Earn" value={fmt(dailyEarnRate)} sub="30d avg" icon={ArrowDownRight} color="text-green-400" />
        <RateCard label="Net Daily" value={fmt(netDailyRate)} sub={netDailyRate >= 0 ? "net positive" : "BURNING"} icon={netDailyRate >= 0 ? TrendingUp : TrendingDown} color={netDailyRate >= 0 ? "text-green-500" : "text-red-500"} />
      </div>

      {/* ── Cash Flow Chart (weekly) ── */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-4">Cash Flow — Last 12 Weeks</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={weeklyData} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#888" }} />
            <YAxis tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="received" name="Received" fill="#22c55e" radius={[3, 3, 0, 0]} />
            <Bar dataKey="spent" name="Spent" fill="#ef4444" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Spending by Trade (Pie) ── */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4">Spending by Trade</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={spendByTrade}
                dataKey="amount"
                nameKey="trade"
                cx="50%"
                cy="50%"
                outerRadius={100}
                innerRadius={50}
                paddingAngle={2}
                label={false}
                labelLine={{ stroke: "#666", strokeWidth: 0.5 }}
              >
                {spendByTrade.map((_, i) => (
                  <Cell key={i} fill={TRADE_COLORS[i % TRADE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* ── Project Spending (Horizontal Bar) ── */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4">Project Spending vs Contract</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={projectSpending} layout="vertical" barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#888" }} width={120} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="contract" name="Contract" fill="rgba(255,255,255,0.1)" radius={[0, 3, 3, 0]} />
              <Bar dataKey="spent" name="Spent" fill="#ef4444" radius={[0, 3, 3, 0]} />
              <Bar dataKey="received" name="Received" fill="#22c55e" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Cumulative Spending Line Chart ── */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-4">Cumulative Cash Flow</h3>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={weeklyData.reduce((acc, w, i) => {
            const prev = i > 0 ? acc[i - 1] : { cumSpent: 0, cumReceived: 0 };
            acc.push({
              week: w.week,
              cumSpent: prev.cumSpent + w.spent,
              cumReceived: prev.cumReceived + w.received,
              cumNet: prev.cumReceived + w.received - prev.cumSpent - w.spent,
            });
            return acc;
          }, [] as { week: string; cumSpent: number; cumReceived: number; cumNet: number }[])}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#888" }} />
            <YAxis tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="cumReceived" name="Total Received" stroke="#22c55e" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="cumSpent" name="Total Spent" stroke="#ef4444" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="cumNet" name="Net Cash" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Unpaid to Subs ── */}
        {unpaidInvoices.length > 0 && (
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b">
              <Receipt className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-semibold">Unpaid to Subs</h3>
              <Badge variant="secondary" className="text-[9px] ml-auto">{unpaidInvoices.length}</Badge>
              <span className="text-sm font-bold text-red-400">{fmt(unpaidInvoices.reduce((s, i) => s + i.amount, 0))}</span>
            </div>
            <div className="divide-y divide-border/50 max-h-[300px] overflow-y-auto">
              {unpaidInvoices.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{inv.vendor_name}</span>
                    <span className="text-muted-foreground ml-2">{inv.project_name}</span>
                  </div>
                  <span className="font-bold text-red-400 tabular-nums">{fmt(inv.amount)}</span>
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
            <div className="divide-y divide-amber-500/10 max-h-[300px] overflow-y-auto">
              {projects.filter((p) => p.outstanding > 0).map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-amber-500/5 transition-colors">
                  <span className="font-medium">{p.name}</span>
                  <span className="font-bold text-amber-400 tabular-nums">{fmt(p.outstanding)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function LiveBadge() {
  return (
    <span className="ml-auto flex items-center gap-1.5 bg-green-500/10 border border-green-500/30 rounded-full px-2.5 py-0.5">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
      </span>
      <span className="text-[10px] font-bold text-green-400 uppercase tracking-wider">Live</span>
    </span>
  );
}

function KpiCard({ label, value, sub, icon: Icon, color }: {
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
      <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div>
        <div className={`text-sm font-bold ${color}`}>{value}</div>
        <div className="text-[9px] text-muted-foreground">{label} · {sub}</div>
      </div>
    </div>
  );
}
