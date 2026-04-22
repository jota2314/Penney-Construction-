"use client";

import Link from "next/link";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign, TrendingUp, Percent, Gavel, ArrowRight,
  CheckCircle2, Clock, Building2, Target,
} from "lucide-react";
import type { EstimatingHubData } from "@/lib/actions/estimates";
import { OVERHEAD_PCT } from "@/lib/constants/overhead";
import { cn } from "@/lib/utils";

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

const TRADE_COLORS = [
  "#f59e0b", "#3b82f6", "#22c55e", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
];

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  review: "bg-blue-500/20 text-blue-400",
  approved: "bg-green-500/20 text-green-400",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload) return null;
  return (
    <div className="bg-card border rounded-lg px-3 py-2 shadow-xl text-xs">
      {label && <div className="font-medium mb-1">{label}</div>}
      {payload.map((p: { name: string; value: number; color: string }, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function HubDashboard({ data }: { data: EstimatingHubData }) {
  const { pipeline, performance, tradeBreakdown, profitByProject, recentEstimates, bidStats } = data;

  const donutData = tradeBreakdown.map((t) => ({
    name: t.trade,
    value: t.price,
  }));

  // Profit-by-project needs overhead subtracted too so the bar chart
  // matches the KPI cards (net profit after overhead).
  const barData = profitByProject.map((p) => ({
    name: p.projectNumber ? `${p.projectNumber.replace("PC-2026-", "")} ${p.name}`.substring(0, 20) : p.name.substring(0, 20),
    profit: p.profit - p.contract * OVERHEAD_PCT,
    contract: p.contract,
  }));

  return (
    <div className="space-y-6">
      {/* KPI Cards — 2 rows × 4. Top row is the money picture. Bottom is performance. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={DollarSign}
          iconColor="text-amber-500"
          label="Pipeline (Open)"
          value={fmt(pipeline.openValue)}
          sub={`${pipeline.openCount} open · click to see list`}
          href="/estimates?tab=estimates&stage=open"
        />
        <KpiCard
          icon={CheckCircle2}
          iconColor="text-emerald-500"
          label="Won"
          value={fmt(pipeline.wonValue)}
          sub={`${pipeline.wonCount} approved · click to see list`}
          valueColor="text-emerald-400"
          href="/estimates?tab=estimates&stage=won"
        />
        <KpiCard
          icon={Building2}
          iconColor="text-orange-500"
          label="Overhead"
          value={fmt(pipeline.overhead)}
          sub={`${(OVERHEAD_PCT * 100).toFixed(0)}% of pipeline`}
          valueColor="text-orange-400"
        />
        <KpiCard
          icon={TrendingUp}
          iconColor="text-green-500"
          label="Net Profit"
          value={fmt(pipeline.netProfit)}
          sub={`after overhead · ${pipeline.netMargin.toFixed(1)}% margin`}
          valueColor={pipeline.netProfit > 0 ? "text-green-400" : "text-red-400"}
        />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={Percent}
          iconColor="text-blue-500"
          label="Avg Margin (Gross)"
          value={`${pipeline.avgMargin.toFixed(1)}%`}
          sub={pipeline.avgMargin >= 25 ? "healthy" : pipeline.avgMargin >= 15 ? "watch it" : "too low"}
          valueColor={pipeline.avgMargin >= 25 ? "text-green-400" : pipeline.avgMargin >= 15 ? "text-amber-400" : "text-red-400"}
        />
        <KpiCard
          icon={Target}
          iconColor="text-cyan-500"
          label="Close Rate"
          value={performance.closeRateWon + performance.closeRateLost > 0 ? `${performance.closeRate.toFixed(0)}%` : "—"}
          sub={`${performance.closeRateWon} won · ${performance.closeRateLost} lost`}
        />
        <KpiCard
          icon={Clock}
          iconColor="text-indigo-500"
          label="Avg Cycle"
          value={performance.avgCycleDays != null ? `${performance.avgCycleDays.toFixed(0)}d` : "—"}
          sub="draft → approved"
        />
        <KpiCard
          icon={Gavel}
          iconColor="text-purple-500"
          label="Open Bids"
          value={`${bidStats.active}`}
          sub={`${bidStats.awaiting} subs awaiting`}
          href="/estimates?tab=bids"
        />
      </div>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Cost by Trade Donut */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Cost by Trade</h3>
          {donutData.length > 0 ? (
            <div className="flex items-center gap-4">
              <div className="w-48 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      innerRadius={45}
                      paddingAngle={2}
                      label={false}
                    >
                      {donutData.map((_, i) => (
                        <Cell key={i} fill={TRADE_COLORS[i % TRADE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {tradeBreakdown.slice(0, 7).map((t, i) => {
                  const pct = pipeline.totalValue > 0 ? ((t.price / pipeline.totalValue) * 100).toFixed(0) : "0";
                  return (
                    <div key={t.trade} className="flex items-center gap-2 text-xs">
                      <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: TRADE_COLORS[i % TRADE_COLORS.length] }} />
                      <span className="flex-1 truncate text-muted-foreground">{t.trade}</span>
                      <span className="tabular-nums font-medium">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">No line item data yet</p>
          )}
        </div>

        {/* Profit by Project */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Profit by Project</h3>
          {barData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData} layout="vertical" barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: "#888" }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10, fill: "#888" }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="profit" name="Profit" fill="#22c55e" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">No project data yet</p>
          )}
        </div>
      </div>

      {/* Recent Estimates */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <h3 className="text-sm font-semibold">Recent Estimates</h3>
        </div>
        <div className="divide-y">
          {recentEstimates.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No estimates yet</div>
          ) : (
            recentEstimates.map((est) => {
              const margin = est.total_price > 0 ? ((est.total_profit / est.total_price) * 100) : 0;
              return (
                <Link
                  key={est.id}
                  href={est.projectId ? `/projects/${est.projectId}/estimates/${est.id}` : `/estimates/${est.id}`}
                  className="flex items-center gap-3 p-3 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{est.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {est.projectNumber ? `${est.projectNumber} — ` : ""}{est.projectName}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold tabular-nums">{fmt(est.total_price)}</div>
                    {est.total_profit > 0 && (
                      <div className={cn(
                        "text-xs tabular-nums",
                        margin >= 25 ? "text-green-400" : margin >= 15 ? "text-amber-400" : "text-red-400"
                      )}>
                        {fmt(est.total_profit)} profit ({margin.toFixed(0)}%)
                      </div>
                    )}
                  </div>
                  <Badge className={cn("text-[10px] shrink-0", STATUS_COLORS[est.status] || STATUS_COLORS.draft)}>
                    {est.status}
                  </Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  iconColor,
  label,
  value,
  sub,
  valueColor,
  href,
}: {
  icon: typeof DollarSign;
  iconColor: string;
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("h-4 w-4", iconColor)} />
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn("text-2xl font-bold tabular-nums", valueColor)}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="rounded-lg border bg-card p-4 hover:bg-accent/50 hover:border-amber-500/40 transition-colors">
        {body}
      </Link>
    );
  }
  return <div className="rounded-lg border bg-card p-4">{body}</div>;
}
