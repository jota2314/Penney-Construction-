"use client";

import { useEffect, useState } from "react";
import { getQuoteCoverage, type QuoteCoverageLine } from "@/lib/actions/quote-coverage";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

interface QuoteCoverageViewProps {
  projectId: string;
  estimateId: string;
}

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);

const coverageIcon = {
  none: <XCircle className="h-4 w-4 text-red-500" />,
  single: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  covered: <CheckCircle className="h-4 w-4 text-green-500" />,
};

const coverageLabel = {
  none: "No Quotes",
  single: "1 Quote",
  covered: "2+ Quotes",
};

const coverageBg = {
  none: "border-red-500/20 bg-red-500/5",
  single: "border-amber-500/20 bg-amber-500/5",
  covered: "border-green-500/20 bg-green-500/5",
};

export function QuoteCoverageView({ projectId, estimateId }: QuoteCoverageViewProps) {
  const [lines, setLines] = useState<QuoteCoverageLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLine, setExpandedLine] = useState<string | null>(null);

  useEffect(() => {
    getQuoteCoverage(projectId, estimateId).then((data) => {
      setLines(data);
      setLoading(false);
    });
  }, [projectId, estimateId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading quote coverage...
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground">
        No estimate lines found. Create an estimate first.
      </div>
    );
  }

  // Summary stats
  const totalLines = lines.length;
  const coveredCount = lines.filter((l) => l.coverage === "covered").length;
  const singleCount = lines.filter((l) => l.coverage === "single").length;
  const noneCount = lines.filter((l) => l.coverage === "none").length;
  const totalBudget = lines.reduce((sum, l) => sum + l.budgeted_cost, 0);
  const totalAverage = lines.reduce((sum, l) => sum + (l.average_quote || l.budgeted_cost), 0);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-3 text-center">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Lines</div>
          <div className="text-lg font-bold">{totalLines}</div>
        </div>
        <div className="rounded-xl border bg-card p-3 text-center">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Covered (2+)</div>
          <div className="text-lg font-bold text-green-500">{coveredCount}</div>
        </div>
        <div className="rounded-xl border bg-card p-3 text-center">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Need 2nd Quote</div>
          <div className="text-lg font-bold text-amber-500">{singleCount}</div>
        </div>
        <div className="rounded-xl border bg-card p-3 text-center">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">No Quotes</div>
          <div className="text-lg font-bold text-red-500">{noneCount}</div>
        </div>
      </div>

      {/* Budget vs Market bar */}
      {totalAverage > 0 && totalAverage !== totalBudget && (
        <div className={`rounded-xl border p-3 flex items-center justify-between text-sm ${
          totalBudget >= totalAverage ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5"
        }`}>
          <span className="text-muted-foreground">Your budget vs quote averages:</span>
          <span className={`font-bold flex items-center gap-1 ${totalBudget >= totalAverage ? "text-green-500" : "text-red-500"}`}>
            {totalBudget >= totalAverage ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {fmt(Math.abs(totalBudget - totalAverage))} {totalBudget >= totalAverage ? "buffer" : "under market"}
          </span>
        </div>
      )}

      {/* Line items with quotes */}
      <div className="space-y-2">
        {lines.map((line) => {
          const isExpanded = expandedLine === line.line_item_id;
          const hasApproved = !!line.approved_quote_id;

          return (
            <div
              key={line.line_item_id}
              className={`rounded-xl border overflow-hidden transition-colors ${coverageBg[line.coverage]}`}
            >
              {/* Line header — always visible */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors"
                onClick={() => setExpandedLine(isExpanded ? null : line.line_item_id)}
              >
                {coverageIcon[line.coverage]}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{line.description}</span>
                    <Badge variant="secondary" className="text-[9px]">{line.trade}</Badge>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                    <span>Budget: {fmt(line.budgeted_cost)}</span>
                    {line.quote_count > 0 && (
                      <>
                        <span>·</span>
                        <span>Avg: {fmt(line.average_quote)}</span>
                        <span>·</span>
                        <span className={line.budget_vs_average >= 0 ? "text-green-500" : "text-red-500"}>
                          {line.budget_vs_average >= 0 ? "+" : ""}{fmt(line.budget_vs_average)}
                        </span>
                      </>
                    )}
                    {hasApproved && (
                      <>
                        <span>·</span>
                        <span className="text-cyan-400">Approved: {fmt(line.approved_amount || 0)}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={`text-[9px] ${
                    line.coverage === "covered" ? "text-green-500 border-green-500/30" :
                    line.coverage === "single" ? "text-amber-500 border-amber-500/30" :
                    "text-red-500 border-red-500/30"
                  }`}>
                    {coverageLabel[line.coverage]}
                  </Badge>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>

              {/* Expanded: show individual quotes */}
              {isExpanded && (
                <div className="px-4 pb-3 space-y-2 border-t border-border/30 pt-3">
                  {line.quotes.length === 0 ? (
                    <div className="text-xs text-muted-foreground/60 text-center py-4 italic">
                      No quotes received for this trade yet. Request quotes from subs.
                    </div>
                  ) : (
                    <>
                      {line.quotes.map((q) => (
                        <div
                          key={q.id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${
                            q.status === "approved" ? "bg-cyan-500/10 border border-cyan-500/20" : "bg-muted/30"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{q.subcontractor_name}</div>
                            {q.scope_description && (
                              <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                                {q.scope_description}
                              </div>
                            )}
                          </div>

                          <Badge variant="outline" className={`text-[9px] shrink-0 ${
                            q.status === "approved" ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" :
                            q.status === "received" ? "bg-green-500/15 text-green-400 border-green-500/30" :
                            "text-muted-foreground"
                          }`}>
                            {q.status}
                          </Badge>

                          <span className={`font-bold tabular-nums shrink-0 ${
                            q.status === "approved" ? "text-cyan-400" : "text-foreground"
                          }`}>
                            {q.amount ? fmt(q.amount) : "—"}
                          </span>

                          {/* Comparison to budget */}
                          {q.amount && line.budgeted_cost > 0 && (
                            <span className={`text-[10px] font-medium shrink-0 ${
                              Number(q.amount) <= line.budgeted_cost ? "text-green-500" : "text-red-500"
                            }`}>
                              {Number(q.amount) <= line.budgeted_cost
                                ? `-${fmt(line.budgeted_cost - Number(q.amount))}`
                                : `+${fmt(Number(q.amount) - line.budgeted_cost)}`
                              }
                            </span>
                          )}
                        </div>
                      ))}

                      {/* Average summary */}
                      {line.quote_count >= 2 && (
                        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/20 text-xs">
                          <span className="text-muted-foreground">Average of {line.quote_count} quotes:</span>
                          <span className="font-bold">{fmt(line.average_quote)}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
