"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSearchParamState } from "@/lib/hooks/use-search-param-state";
import {
  ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import {
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Building2, Timer, FileText, Receipt,
  AlertTriangle, Users, Scale, ChevronDown, ChevronUp, Gauge, Wallet, ArrowRight,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { OpenBillsCard } from "./open-bills-card";
import type { OpenBillsSummary } from "@/lib/finance/open-bills";
import { CollectionPlanCard } from "./collection-plan-card";
import type { PublishedCollectionPlan } from "@/lib/finance/published-collection-plan";

/* ── Types ── */

export type Period = "all" | "year" | "month" | "week" | "daily";

export interface PeriodView {
  spent: number;
  received: number;
  /** Same point in the previous period, for the ▲/▼ comparison. */
  prev: { label: string; spent: number; received: number } | null;
  trendTitle: string;
  trend: { label: string; spent: number; received: number; future: boolean }[];
  /** Cash-basis spend by chart-of-accounts category (same buckets as /spent). */
  whereItWent: { key: string; label: string; dot: string; amount: number }[];
}

export interface ProjectHealth {
  id: string;
  name: string;
  projectNumber: string | null;
  contract: number;
  received: number;
  jobCost: number;
  leftToCollect: number;
  coRevenue: number;
  coCount: number;
  unpaidBills: number;
}

interface LiveDaily {
  laborCost: number;
  invoiceSpend: number;
  received: number;
  clockedIn: number;
  clockedInNames: string[];
}

interface CeoDashboardProps {
  collectionPlan: PublishedCollectionPlan;
  totals: {
    totalContractValue: number;
    totalReceived: number;
    totalOutstanding: number;
    totalApprovedCOs: number;
    projectCount: number;
  };
  views: Record<Period, PeriodView>;
  liveDaily: LiveDaily;
  estimatesSent: number;
  estimatesWon: number;
  estimatesTotal: number;
  projectHealth: ProjectHealth[];
  openBills: OpenBillsSummary;
  dailySpendRate: number;
  dailyEarnRate: number;
  laborHours30d: number;
  laborCost30d: number;
  /** Year-to-date overhead from the /overhead report (office payroll split + running costs, no capex). */
  overhead: {
    total: number;
    pctOfRevenue: number | null;
    runRate: number | null;
    payrollThrough: string | null;
  };
  /** Last day of the imported Eastern statements; card payoffs after it are not in Money out yet. */
  bankThrough: string | null;
}

/* ── Formatting ── */

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

const kfmt = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1_000_000 ? `$${(a / 1_000_000).toFixed(1)}M` : a >= 1000 ? `$${Math.round(a / 1000)}k` : `$${Math.round(a)}`;
  return v < 0 ? `-${s}` : s;
};

const fmtMonth = (ym: string) =>
  new Date(`${ym}-01T12:00:00`).toLocaleString("en-US", { month: "short" });

const fmtDay = (ymd: string) =>
  new Date(`${ymd.slice(0, 10)}T12:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" });

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

const PERIOD_LABELS: Record<Period, string> = {
  all: "All Time",
  year: "This Year",
  month: "This Month",
  week: "This Week",
  daily: "Today",
};

const GREEN = "#22c55e";
const RED = "#ef4444";
const AMBER = "#f59e0b";
const GRID = "rgba(136,136,136,0.15)";
const TICK = { fontSize: 10, fill: "#888" };

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload) return null;
  return (
    <div className="bg-card border rounded-lg px-3 py-2 shadow-xl text-xs">
      <div className="font-medium mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium tabular-nums">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

/* ── Main Component ── */

export function CeoDashboard({
  totals, collectionPlan, views, liveDaily, estimatesSent, estimatesWon, estimatesTotal,
  projectHealth, openBills,
  dailySpendRate, dailyEarnRate, laborHours30d, laborCost30d, overhead, bankThrough,
}: CeoDashboardProps) {
  const [period, setPeriod] = useSearchParamState("period", "year") as [Period, (v: string) => void];
  const router = useRouter();

  // Auto-refresh every 30s when on Today (live mode). Skip ticks while the
  // tab is hidden — each refresh re-runs the whole server page.
  useEffect(() => {
    if (period !== "daily") return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    return () => clearInterval(interval);
  }, [period, router]);

  const view = views[period] ?? views.year;
  const isLive = period === "daily";
  const net = view.received - view.spent;
  const netDailyRate = dailyEarnRate - dailySpendRate;
  const winRate = pct(estimatesWon, estimatesSent);

  // Running net line over the trend buckets (future buckets stay blank).
  const trendData = useMemo(
    () =>
      view.trend.reduce<(PeriodView["trend"][number] & { net: number | null })[]>((acc, b) => {
        const prevNet = acc.length > 0 ? (acc[acc.length - 1].net ?? 0) : 0;
        acc.push({ ...b, net: b.future ? null : prevNet + b.received - b.spent });
        return acc;
      }, []),
    [view.trend],
  );

  return (
    <div className="@container/dashboard space-y-6">
      {/* ── Period Toggle ── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Business performance</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Financial overview</h2>
            <p className="mt-1 text-xs text-muted-foreground">Cash movement, collections and performance at a glance.</p>
          </div>
        <div role="group" aria-label="Cash flow period" className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`shrink-0 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                period === p
                  ? p === "daily"
                    ? "bg-green-700 text-white shadow-sm"
                    : "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {p === "daily" && <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-green-300" /></span>}
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        </div>
        {isLive ? (
          <div className="flex items-center gap-2 rounded-xl border border-green-500/20 bg-green-500/5 px-3 py-2.5 text-xs text-green-700 dark:text-green-400"><span className="h-1.5 w-1.5 rounded-full bg-green-500" />Live cash activity · refreshes every 30 seconds</div>
        ) : (
          <div className="rounded-xl border bg-card/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Cash basis.</span> Money that moved through the bank. Matches{" "}
            <Link href="/spent" className="underline underline-offset-2 hover:text-foreground">Expenses</Link> and{" "}
            <Link href="/payments" className="underline underline-offset-2 hover:text-foreground">Income</Link>.
            {bankThrough && (
              <span className="text-amber-700 dark:text-amber-400">
                {" "}Bank statements loaded thru {fmtDay(bankThrough)}, so card spend after that isn&apos;t in Money out yet.
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Hero: In / Out / Net ── */}
      <div className="grid grid-cols-1 @min-[32rem]/dashboard:grid-cols-3 gap-3 sm:gap-4">
        <HeroCard
          label={isLive ? "Received today" : "Money in"}
          value={view.received}
          tone="green"
          icon={ArrowDownRight}
          live={isLive}
          href="/payments"
          delta={view.prev ? { now: view.received, then: view.prev.received, label: view.prev.label, goodWhenUp: true } : null}
          sub={
            isLive
              ? `30-day avg ${fmt(dailyEarnRate)}/day`
              : `${fmt(totals.totalOutstanding)} left to collect on contracts`
          }
        />
        <HeroCard
          label={isLive ? "Spent today" : "Money out"}
          value={view.spent}
          tone="red"
          icon={ArrowUpRight}
          live={isLive}
          delta={view.prev ? { now: view.spent, then: view.prev.spent, label: view.prev.label, goodWhenUp: false } : null}
          sub={
            isLive
              ? [
                  liveDaily.invoiceSpend > 0 ? `${fmt(liveDaily.invoiceSpend)} bills` : null,
                  liveDaily.laborCost > 0 ? `${fmt(liveDaily.laborCost)} crew labor` : null,
                ].filter(Boolean).join(" + ") || "Nothing spent yet today"
              : `${fmt(openBills.total)} in recorded open bills (${openBills.bills.length})`
          }
          href={isLive ? undefined : "/spent"}
        />
        <HeroCard
          label={isLive ? "Net today" : "Net cash"}
          value={net}
          tone={net >= 0 ? "green" : "red"}
          icon={net >= 0 ? TrendingUp : TrendingDown}
          live={isLive}
          delta={
            view.prev
              ? { now: net, then: view.prev.received - view.prev.spent, label: view.prev.label, goodWhenUp: true, dollars: true }
              : null
          }
          sub={view.received > 0 ? `Kept ${pct(net, view.received)}¢ of every dollar in` : "In minus out"}
        />
      </div>

      {/* ── Crew on the Clock (only in live mode) ── */}
      {isLive && liveDaily.clockedIn > 0 && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Users className="h-5 w-5 text-green-400" />
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
              </span>
            </div>
            <div className="min-w-0">
              <span className="text-sm font-semibold text-green-400">{liveDaily.clockedIn} crew on the clock</span>
              <span className="text-xs text-muted-foreground ml-3">{liveDaily.clockedInNames.join(", ")}</span>
            </div>
            <span className="ml-auto text-sm font-bold text-green-400 tabular-nums">{fmt(liveDaily.laborCost)}</span>
          </div>
        </div>
      )}

      {/* ── Secondary KPIs ── */}
      <div className="grid grid-cols-2 @min-[34rem]/dashboard:grid-cols-3 @min-[76rem]/dashboard:grid-cols-6 gap-3">
        <KpiCard
          label="Contracts"
          value={fmt(totals.totalContractValue)}
          sub={`${totals.projectCount} active · ${pct(totals.totalReceived, totals.totalContractValue)}% collected`}
          icon={Building2}
          color="text-foreground"
        />
        <KpiCard
          label="Win rate"
          value={`${winRate}%`}
          sub={`${estimatesWon} won of ${estimatesSent} sent · ${estimatesTotal} total`}
          icon={FileText}
          color="text-amber-700 dark:text-amber-400"
        />
        <KpiCard
          label="30-day pace"
          value={`${netDailyRate >= 0 ? "+" : ""}${fmt(netDailyRate)}/day`}
          sub={`${fmt(dailyEarnRate)} in · ${fmt(dailySpendRate)} out`}
          icon={Gauge}
          color={netDailyRate >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}
        />
        <KpiCard
          label="Labor (30d)"
          value={`${laborHours30d}h`}
          sub={`${fmt(laborCost30d)} wages`}
          icon={Timer}
          color="text-blue-700 dark:text-blue-400"
        />
        <Link href="/overhead" className="group block min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <KpiCard
            label={overhead.payrollThrough ? `Overhead (Jan–${fmtMonth(overhead.payrollThrough)})` : `Overhead (${new Date().getFullYear()})`}
            value={fmt(overhead.total)}
            sub={[
              overhead.pctOfRevenue !== null ? `${overhead.pctOfRevenue.toFixed(1)}% of collected` : null,
              overhead.runRate !== null && overhead.payrollThrough
                ? `${fmtMonth(overhead.payrollThrough)} alone ${fmt(overhead.runRate)}`
                : null,
              overhead.payrollThrough ? null : "no payroll split",
            ].filter(Boolean).join(" · ")}
            icon={Receipt}
            color="text-orange-700 dark:text-orange-400"
          />
        </Link>
        <Dialog>
          <DialogTrigger asChild>
            <button type="button" className="group block min-w-0 cursor-pointer rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <KpiCard
                label="Left to collect"
                value={fmt(totals.totalOutstanding)}
                sub="View weekly & monthly collection plan"
                icon={Wallet}
                color="text-amber-700 dark:text-amber-400"
              />
            </button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined} className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
            <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
              <DialogTitle>Left to collect</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto p-3 sm:p-5">
              <CollectionPlanCard plan={collectionPlan} expanded />
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* ── Cash Flow Trend (follows the period toggle) ── */}
      <div className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h3 className="text-base font-semibold tracking-tight">{view.trendTitle}</h3>
          <span className="text-[11px] text-muted-foreground">Bars = in / out · dashed line = running net</span>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={trendData} barGap={1}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={TICK} interval="preserveStartEnd" minTickGap={8} />
            <YAxis yAxisId="bars" tick={TICK} tickFormatter={kfmt} width={52} />
            <YAxis yAxisId="net" orientation="right" tick={TICK} tickFormatter={kfmt} width={52} />
            <ReferenceLine yAxisId="net" y={0} stroke={GRID} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(136,136,136,0.08)" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="bars" dataKey="received" name="In" fill={GREEN} radius={[3, 3, 0, 0]} maxBarSize={28}>
              {trendData.map((d, i) => <Cell key={i} fillOpacity={d.future ? 0.2 : 1} />)}
            </Bar>
            <Bar yAxisId="bars" dataKey="spent" name="Out" fill={RED} radius={[3, 3, 0, 0]} maxBarSize={28}>
              {trendData.map((d, i) => <Cell key={i} fillOpacity={d.future ? 0.2 : 1} />)}
            </Bar>
            <Line yAxisId="net" type="monotone" dataKey="net" name="Running net" stroke={AMBER} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Where the money went ── */}
        <div className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-semibold">Where the money went</h3>
            <span className="text-[11px] text-muted-foreground">{PERIOD_LABELS[period]}</span>
          </div>
          <WhereItWent rows={view.whereItWent} total={view.spent} isLive={isLive} />
        </div>

        {/* ── Owed by clients ── */}
        <div id="collections" className="min-w-0 scroll-mt-20 rounded-2xl border border-amber-500/20 bg-amber-500/5 overflow-hidden lg:col-span-3">
          <div className="flex flex-wrap items-center gap-3 px-4 py-4 border-b border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">Left to collect</h3>
            <span className="ml-auto text-sm font-bold text-amber-700 dark:text-amber-400 tabular-nums">{fmt(totals.totalOutstanding)}</span>
          </div>
          <div className="px-4 py-1.5 text-[11px] text-muted-foreground border-b border-amber-500/10">
            Contract + approved COs − payments received · incl. {fmt(totals.totalApprovedCOs)} approved COs
          </div>
          <div className="divide-y divide-amber-500/10 max-h-[320px] overflow-y-auto">
            {projectHealth
              .filter((p) => p.leftToCollect > 0)
              .sort((a, b) => b.leftToCollect - a.leftToCollect)
              .map((p) => {
                const collected = pct(p.received, p.contract);
                return (
                  <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-amber-500/5 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="mt-1 h-1.5 rounded-full bg-amber-500/10 overflow-hidden">
                        <div className="h-full bg-green-500/70" style={{ width: `${Math.min(100, collected)}%` }} />
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {collected}% collected of {fmt(p.contract)}
                        {p.coCount > 0 && <> · incl. {fmt(p.coRevenue)} COs ({p.coCount})</>}
                      </div>
                    </div>
                    <span className="font-bold text-amber-700 dark:text-amber-400 tabular-nums shrink-0">{fmt(p.leftToCollect)}</span>
                  </Link>
                );
              })}
          </div>
        </div>
      </div>

      {/* ── Project health ── */}
      <ProjectHealthTable rows={projectHealth} />

      <OpenBillsCard summary={openBills} />
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
      <span className="text-[10px] font-bold text-green-700 dark:text-green-400 uppercase tracking-wider">Live</span>
    </span>
  );
}

function HeroCard({ label, value, tone, icon: Icon, live, delta, sub, href }: {
  label: string;
  value: number;
  tone: "green" | "red";
  icon: React.ComponentType<{ className?: string }>;
  live: boolean;
  /** dollars: show the $ change instead of % (a % off a tiny net base is noise). */
  delta: { now: number; then: number; label: string; goodWhenUp: boolean; dollars?: boolean } | null;
  sub: string;
  href?: string;
}) {
  const text = tone === "green" ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400";
  const chip = tone === "green" ? "bg-green-500/10 ring-green-500/15" : "bg-red-500/10 ring-red-500/15";

  let deltaEl: React.ReactNode = null;
  if (delta) {
    const diff = delta.now - delta.then;
    const up = diff >= 0;
    const good = up === delta.goodWhenUp;
    const change = delta.then !== 0 && !delta.dollars ? Math.round((diff / Math.abs(delta.then)) * 100) : null;
    deltaEl = (
      <div className={`mt-2 inline-flex max-w-full flex-wrap items-center gap-1 rounded-full px-2 py-0.5 text-[11px] [overflow-wrap:anywhere] font-medium ${good ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
        {up ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        <span className="tabular-nums">{change !== null ? `${Math.abs(change)}%` : kfmt(Math.abs(diff))}</span>
        <span className="text-muted-foreground font-normal">vs {delta.label} ({kfmt(delta.then)})</span>
      </div>
    );
  }

  const body = (
    <div className={`@container relative flex min-w-0 h-full flex-col rounded-2xl border bg-card bg-gradient-to-br p-4 sm:p-5 ${tone === "green" ? "from-green-500/[0.06] to-transparent border-green-500/20" : "from-red-500/[0.04] to-transparent border-red-500/15"} ${href ? "transition-colors hover:border-foreground/30" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className={`h-8 w-8 shrink-0 rounded-lg ring-1 ${chip} flex items-center justify-center`}>
          <Icon className={`h-4 w-4 ${text}`} />
        </div>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">{label}</span>
        {live && <LiveBadge />}
      </div>
      {/* Size against the card's available width, including when the sidebar is open. */}
      <div className={`text-[clamp(1.125rem,14cqi,2.75rem)] leading-tight [overflow-wrap:anywhere] font-bold ${text} tabular-nums tracking-tight`}>{fmt(value)}</div>
      {deltaEl}
      <div className="mt-auto pt-4">
        <div className="flex items-start gap-2 border-t border-foreground/10 pt-3 text-xs leading-relaxed text-muted-foreground">
          <span className="min-w-0 flex-1">{sub}</span>
          {href && <ArrowRight aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5" />}
        </div>
      </div>
    </div>
  );
  return href ? <Link href={href} className="group block min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body;
}

function KpiCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub: string; color: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="@container min-w-0 h-full rounded-2xl border bg-card p-4 transition-colors group-hover:border-foreground/30">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-[clamp(0.875rem,12cqi,1.5rem)] leading-tight [overflow-wrap:anywhere] font-semibold tracking-tight tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] leading-relaxed text-muted-foreground mt-1.5">{sub}</div>
    </div>
  );
}

function WhereItWent({ rows, total, isLive }: { rows: PeriodView["whereItWent"]; total: number; isLive: boolean }) {
  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground py-8 text-center">No money out in this period yet.</div>;
  }
  const top = rows.slice(0, 8);
  const rest = rows.slice(8).reduce((s, r) => s + r.amount, 0);
  const base = rows.reduce((s, r) => s + r.amount, 0) || total;
  const max = top[0]?.amount || 1;
  return (
    <div className="space-y-2.5">
      {top.map((r) => (
        <div key={r.key}>
          <div className="flex items-baseline justify-between text-xs mb-1">
            <span className="flex items-center gap-2 font-medium">
              <span className={`h-2 w-2 rounded-full ${r.dot}`} />
              {r.label}
            </span>
            <span className="tabular-nums">
              <span className="font-semibold">{fmt(r.amount)}</span>
              <span className="text-muted-foreground ml-2 inline-block w-8 text-right">{pct(r.amount, base)}%</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${r.dot}`} style={{ width: `${(r.amount / max) * 100}%` }} />
          </div>
        </div>
      ))}
      {rest > 0 && (
        <div className="flex justify-between text-xs text-muted-foreground pt-1">
          <span>Everything else ({rows.length - 8})</span>
          <span className="tabular-nums">{fmt(rest)}</span>
        </div>
      )}
      <div className="text-[11px] text-muted-foreground pt-2 border-t">
        Bills paid out of the bank{isLive ? " (crew labor on the clock not included)" : ""}. Card spend shows as the payoff.{" "}
        <Link href="/spent" className="underline underline-offset-2 hover:text-foreground">See every expense</Link>
      </div>
    </div>
  );
}

type SortKey = "name" | "contract" | "collected" | "gap" | "net";

function ProjectHealthTable({ rows }: { rows: ProjectHealth[] }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "gap", desc: true });

  const enriched = useMemo(
    () =>
      rows.map((p) => {
        const collected = pct(p.received, p.contract);
        const costPct = pct(p.jobCost, p.contract);
        return { ...p, collected, costPct, gap: costPct - collected, net: p.received - p.jobCost };
      }),
    [rows],
  );

  const sorted = useMemo(() => {
    const dir = sort.desc ? -1 : 1;
    return [...enriched].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [enriched, sort]);

  const behind = enriched.filter((p) => p.gap >= 10).length;
  const onSort = (k: SortKey) => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== "name" }));

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b">
        <Scale className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold">Project health</h3>
        <span className="text-[11px] text-muted-foreground">Cost spent vs money collected, per active job</span>
        {behind > 0 && (
          <span className="ml-auto rounded-full bg-red-500/10 text-red-500 px-2 py-0.5 text-[11px] font-medium">
            {behind} spending ahead of billing
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground text-left border-b">
            <tr>
              <Th k="name" sort={sort} onSort={onSort}>Project</Th>
              <Th k="contract" sort={sort} onSort={onSort} className="text-right">Contract</Th>
              <Th k="collected" sort={sort} onSort={onSort} className="min-w-[160px]">Collected vs cost</Th>
              <Th k="gap" sort={sort} onSort={onSort} className="text-right">Gap</Th>
              <Th k="net" sort={sort} onSort={onSort} className="text-right">Net cash</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {sorted.map((p) => {
              const flag = p.gap >= 10;
              return (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    {p.projectNumber && <div className="text-[10px] text-muted-foreground">{p.projectNumber}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(p.contract)}</td>
                  <td className="px-3 py-2">
                    <div className="space-y-1">
                      <MiniBar value={p.collected} className="bg-green-500" label={`${p.collected}% in`} />
                      <MiniBar value={p.costPct} className={flag ? "bg-red-500" : "bg-zinc-400"} label={`${p.costPct}% cost`} />
                    </div>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${flag ? "text-red-500" : p.gap <= -10 ? "text-green-500" : "text-muted-foreground"}`}>
                    {p.gap > 0 ? "+" : ""}{p.gap} pts
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${p.net >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {fmt(p.net)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 text-[11px] text-muted-foreground border-t">
        Cost = every bill on the job (paid or not, incl. card) + clocked crew labor. Gap = cost % minus collected %;
        red means we&apos;ve spent further into the job than we&apos;ve billed — time for a draw.
      </div>
    </div>
  );
}

function Th({ k, sort, onSort, children, className = "" }: {
  k: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-3 py-2 font-medium ${className}`}>
      <button
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-0.5 hover:text-foreground ${sort.key === k ? "text-foreground" : ""}`}
      >
        {children}
        {sort.key === k && (sort.desc ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
      </button>
    </th>
  );
}

function MiniBar({ value, className, label }: { value: number; className: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${className}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <span className="w-16 text-[10px] text-muted-foreground tabular-nums">{label}</span>
    </div>
  );
}
