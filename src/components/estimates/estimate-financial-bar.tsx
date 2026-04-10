"use client";

import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

interface LineItem {
  id: string;
  trade?: string | null;
  total_cost?: number | null;
  total_price?: number | null;
}

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

const COLORS = [
  "#f59e0b", "#3b82f6", "#22c55e", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
];

export function EstimateFinancialBar({ lineItems }: { lineItems: LineItem[] }) {
  const { totalPrice, totalCost, profit, margin, tradeData } = useMemo(() => {
    let price = 0;
    let cost = 0;
    const trades = new Map<string, number>();

    for (const item of lineItems) {
      price += item.total_price || 0;
      cost += item.total_cost || 0;
      const trade = item.trade || "General";
      trades.set(trade, (trades.get(trade) || 0) + (item.total_price || 0));
    }

    const p = price - cost;
    const m = price > 0 ? (p / price) * 100 : 0;

    const data = Array.from(trades.entries())
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    return { totalPrice: price, totalCost: cost, profit: p, margin: m, tradeData: data };
  }, [lineItems]);

  if (lineItems.length === 0) return null;

  const marginColor = margin >= 25 ? "text-green-400" : margin >= 15 ? "text-amber-400" : "text-red-400";
  const barWidth = Math.min(Math.max(margin, 0), 40) / 40 * 100;
  const barColor = margin >= 25 ? "bg-green-500" : margin >= 15 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4 mb-4 sticky top-0 z-10">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {/* Main numbers */}
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Contract</div>
          <div className="text-lg font-bold tabular-nums">{fmt(totalPrice)}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Cost</div>
          <div className="text-lg font-bold tabular-nums text-muted-foreground">{fmt(totalCost)}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Profit</div>
          <div className={cn("text-lg font-bold tabular-nums", profit >= 0 ? "text-green-400" : "text-red-400")}>
            {fmt(profit)}
          </div>
        </div>

        {/* Margin gauge */}
        <div className="flex-1 min-w-[120px]">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Margin</span>
            <span className={cn("text-sm font-bold tabular-nums", marginColor)}>
              {margin.toFixed(1)}%
            </span>
            <span className="text-[10px] text-muted-foreground">/ 30% target</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", barColor)}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>

        {/* Mini trade donut */}
        {tradeData.length > 0 && (
          <div className="hidden md:flex items-center gap-2">
            <div className="w-10 h-10">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={tradeData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={12}
                    outerRadius={18}
                    strokeWidth={0}
                  >
                    {tradeData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {tradeData.slice(0, 4).map((t, i) => {
                const pct = totalPrice > 0 ? ((t.value / totalPrice) * 100).toFixed(0) : "0";
                return (
                  <div key={t.name} className="flex items-center gap-1 text-[10px]">
                    <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-muted-foreground">{t.name}</span>
                    <span className="font-medium">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
