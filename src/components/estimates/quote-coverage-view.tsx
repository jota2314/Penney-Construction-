"use client";

import { useEffect, useState } from "react";
import { getQuoteCoverage, type QuoteCoverageLine } from "@/lib/actions/quote-coverage";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Wrench,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

interface QuoteCoverageViewProps {
  projectId: string;
}

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);

const coverageConfig = {
  internal: { icon: <Wrench className="h-4 w-4 text-muted-foreground" />, label: "Internal", bg: "border-border/30 bg-muted/10 opacity-60", badge: "text-muted-foreground border-border" },
  none: { icon: <XCircle className="h-4 w-4 text-red-500" />, label: "No Quotes", bg: "border-red-500/20 bg-red-500/5", badge: "text-red-500 border-red-500/30" },
  single: { icon: <AlertTriangle className="h-4 w-4 text-amber-500" />, label: "1 Quote", bg: "border-amber-500/20 bg-amber-500/5", badge: "text-amber-500 border-amber-500/30" },
  covered: { icon: <CheckCircle className="h-4 w-4 text-green-500" />, label: "2+ Quotes", bg: "border-green-500/20 bg-green-500/5", badge: "text-green-500 border-green-500/30" },
};

export function QuoteCoverageView({ projectId }: QuoteCoverageViewProps) {
  const [lines, setLines] = useState<QuoteCoverageLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [showInternal, setShowInternal] = useState(false);

  useEffect(() => {
    getQuoteCoverage(projectId).then(({ lines: data }) => {
      setLines(data);
      setLoading(false);
    });
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading quote coverage...
      </div>
    );
  }

  if (lines.length === 0) return null;

  // Separate sub lines from internal
  const subLines = lines.filter((l) => l.coverage !== "internal");
  const internalLines = lines.filter((l) => l.coverage === "internal");
  const coveredCount = subLines.filter((l) => l.coverage === "covered").length;
  const singleCount = subLines.filter((l) => l.coverage === "single").length;
  const noneCount = subLines.filter((l) => l.coverage === "none").length;

  // Budget vs market (only for lines with quotes)
  const linesWithQuotes = subLines.filter((l) => l.average_quote > 0);
  const totalBudget = linesWithQuotes.reduce((sum, l) => sum + l.budgeted_cost, 0);
  const totalAverage = linesWithQuotes.reduce((sum, l) => sum + l.average_quote, 0);

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MiniStat label="Need Quotes" value={noneCount} color="text-red-500" />
        <MiniStat label="Need 2nd" value={singleCount} color="text-amber-500" />
        <MiniStat label="Covered" value={coveredCount} color="text-green-500" />
        <MiniStat label="Internal" value={internalLines.length} color="text-muted-foreground" />
      </div>

      {/* Budget vs Market */}
      {totalAverage > 0 && (
        <div className={`rounded-lg border p-2.5 flex items-center justify-between text-xs ${
          totalBudget >= totalAverage ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5"
        }`}>
          <span className="text-muted-foreground">Budget vs quote averages ({linesWithQuotes.length} lines):</span>
          <span className={`font-bold flex items-center gap-1 ${totalBudget >= totalAverage ? "text-green-500" : "text-red-500"}`}>
            {totalBudget >= totalAverage ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {fmt(Math.abs(totalBudget - totalAverage))} {totalBudget >= totalAverage ? "buffer" : "under"}
          </span>
        </div>
      )}

      {/* Sub lines (need quotes) */}
      <div className="space-y-1.5">
        {subLines.map((line) => {
          const cfg = coverageConfig[line.coverage];
          const isExpanded = expandedLine === line.line_item_id;

          return (
            <div key={line.line_item_id} className={`rounded-lg border overflow-hidden ${cfg.bg}`}>
              <div
                className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-muted/20 transition-colors"
                onClick={() => setExpandedLine(isExpanded ? null : line.line_item_id)}
              >
                {cfg.icon}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{line.description}</span>
                    <span className="text-[10px] text-muted-foreground">{line.trade}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>Budget: {fmt(line.budgeted_cost)}</span>
                    {line.quote_count > 0 && (
                      <>
                        <span>·</span>
                        <span>Avg: {fmt(line.average_quote)}</span>
                        <span className={line.budget_vs_average >= 0 ? "text-green-500" : "text-red-500"}>
                          ({line.budget_vs_average >= 0 ? "+" : ""}{fmt(line.budget_vs_average)})
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <Badge variant="outline" className={`text-[9px] shrink-0 ${cfg.badge}`}>
                  {line.quote_count > 0 ? `${line.quote_count} quote${line.quote_count !== 1 ? "s" : ""}` : cfg.label}
                </Badge>
                {line.quotes.length > 0 && (
                  isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </div>

              {isExpanded && line.quotes.length > 0 && (
                <div className="px-3 pb-2.5 space-y-1 border-t border-border/30 pt-2">
                  {line.quotes.map((q) => (
                    <div key={q.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded text-xs ${
                      q.status === "approved" ? "bg-cyan-500/10 border border-cyan-500/20" : "bg-muted/30"
                    }`}>
                      <span className="flex-1 font-medium">{q.subcontractor_name}</span>
                      <Badge variant="outline" className={`text-[8px] ${
                        q.status === "approved" ? "text-cyan-400 border-cyan-500/30" : "text-muted-foreground"
                      }`}>{q.status}</Badge>
                      <span className={`font-bold tabular-nums ${q.status === "approved" ? "text-cyan-400" : ""}`}>
                        {q.amount ? fmt(q.amount) : "—"}
                      </span>
                    </div>
                  ))}
                  {line.quote_count >= 2 && (
                    <div className="flex justify-between px-2.5 py-1 text-[10px] text-muted-foreground">
                      <span>Average:</span>
                      <span className="font-bold">{fmt(line.average_quote)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Internal lines (collapsible) */}
      {internalLines.length > 0 && (
        <div>
          <button
            onClick={() => setShowInternal(!showInternal)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Wrench className="h-3 w-3" />
            {internalLines.length} internal lines (no quotes needed)
            {showInternal ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showInternal && (
            <div className="mt-1.5 space-y-1">
              {internalLines.map((line) => (
                <div key={line.line_item_id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/20 bg-muted/5 opacity-50">
                  <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm">{line.description}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{fmt(line.budgeted_cost)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border bg-card p-2 text-center">
      <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}
