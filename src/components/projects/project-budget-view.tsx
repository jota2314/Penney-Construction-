"use client";

import { TrendingUp, TrendingDown, Clock } from "lucide-react";
import type { Project } from "@/types/database";
import type { ProjectLaborCost } from "@/lib/actions/labor-cost";

interface BudgetLineItem {
  description: string;
  total_price: number;
}

interface ProjectBudgetViewProps {
  project: Project;
  estimateName: string | null;
  lineItems: BudgetLineItem[];
  laborCost: ProjectLaborCost;
}

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);

export function ProjectBudgetView({
  project,
  estimateName,
  lineItems,
  laborCost,
}: ProjectBudgetViewProps) {
  const contractVal = project.contract_value ?? 0;
  const estimatedVal = project.estimated_value ?? 0;
  const changeOrdersTotal = 0; // placeholder
  const laborSpent = laborCost.totalCents / 100;
  const totalBudget = contractVal + changeOrdersTotal;
  const budgetBase = totalBudget || estimatedVal;
  // Clocked field labor is the only live cost source wired in so far.
  const totalSpent = laborSpent;
  const remaining = budgetBase - totalSpent;
  const budgetHealthy = remaining >= 0;
  const spentPct = budgetBase > 0 ? (totalSpent / budgetBase) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* ── Summary cards ── */}
      <div className="rounded-xl border-2 border-border bg-card overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-border">
          <div className="p-5">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Budget
            </div>
            <div className="text-3xl font-bold mt-1">{fmt(budgetBase)}</div>
            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
              {contractVal > 0 && <div>Contract: {fmt(contractVal)}</div>}
              {changeOrdersTotal > 0 && (
                <div>Change Orders: +{fmt(changeOrdersTotal)}</div>
              )}
              {contractVal === 0 && estimatedVal > 0 && (
                <div>Estimated: {fmt(estimatedVal)}</div>
              )}
            </div>
          </div>
          <div className="p-5">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Spent
            </div>
            <div
              className={`text-3xl font-bold mt-1 ${totalSpent > 0 ? "text-red-600" : ""}`}
            >
              {fmt(totalSpent)}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
              <span>Labor · {laborCost.totalHours}h clocked</span>
              {laborCost.workersOnClock > 0 && (
                <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  {laborCost.workersOnClock} on clock
                </span>
              )}
            </div>
            <div className="mt-2">
              <div
                className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                  budgetHealthy
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                }`}
              >
                {budgetHealthy ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {fmt(Math.abs(remaining))} {budgetHealthy ? "remaining" : "over"}
              </div>
            </div>
          </div>
        </div>
        {budgetBase > 0 && (
          <div className="px-5 pb-4">
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  budgetHealthy ? "bg-green-500" : "bg-red-500"
                }`}
                style={{ width: `${Math.min(spentPct, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Budget Breakdown ── */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Budget Breakdown</h3>
              {estimateName && (
                <div className="text-xs text-muted-foreground">
                  From: {estimateName}
                </div>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {lineItems.length} items
            </span>
          </div>
        </div>

        {lineItems.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No budget breakdown available. Create an estimate to see line items.
          </div>
        ) : (
          <>
            <div className="divide-y">
              {lineItems.map((item, i) => {
                const pct =
                  budgetBase > 0
                    ? (item.total_price / budgetBase) * 100
                    : 0;
                return (
                  <div key={i} className="px-4 sm:px-5 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{item.description}</span>
                      <span className="text-sm font-bold tabular-nums shrink-0">
                        {fmt(item.total_price)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-orange-400"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums w-9 text-right">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-4 sm:px-5 py-3.5 border-t bg-muted/20">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Total</span>
                <span className="text-sm font-bold tabular-nums">
                  {fmt(lineItems.reduce((s, li) => s + li.total_price, 0))}
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Labor (clocked field time) ── */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Labor (clocked time)
              </h3>
              <div className="text-xs text-muted-foreground">
                Field hours × hourly rate, by task
              </div>
            </div>
            <span className="text-sm font-bold tabular-nums">{fmt(laborSpent)}</span>
          </div>
        </div>

        {laborCost.byLineItem.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No clocked field time on this job yet.
          </div>
        ) : (
          <>
            <div className="divide-y">
              {laborCost.byLineItem.map((item) => {
                const dollars = item.cents / 100;
                const pct = laborSpent > 0 ? (dollars / laborSpent) * 100 : 0;
                return (
                  <div key={item.key} className="px-4 sm:px-5 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{item.description}</span>
                      <span className="text-sm font-bold tabular-nums shrink-0">
                        {fmt(dollars)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-sky-400"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 w-14 text-right">
                        {item.hours.toFixed(1)}h
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {laborCost.missingRateLogs > 0 && (
              <div className="px-4 sm:px-5 py-2.5 border-t bg-amber-50 dark:bg-amber-900/15 text-[11px] text-amber-700 dark:text-amber-400">
                {laborCost.missingRateLogs} shift{laborCost.missingRateLogs === 1 ? "" : "s"} from
                hourly workers with no rate set — labor cost is understated. Set rates on the
                Employees page.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
