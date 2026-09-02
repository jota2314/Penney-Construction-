"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { assessReadiness, type ReadinessLine } from "@/lib/estimates/readiness";
import type { ChecklistAnswers, ChecklistQuestion } from "@/lib/constants/walkthrough-checklist";
import { ShieldCheck, ShieldAlert, ShieldX, ChevronDown, ChevronUp } from "lucide-react";

const fmt = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

interface Props {
  lineItems: ReadinessLine[];
  projectType?: string | null;
  checklist?: { questions: ChecklistQuestion[]; answers: ChecklistAnswers } | null;
}

const VERDICT = {
  ready: { label: "Ready to send", icon: ShieldCheck, tone: "text-green-400", ring: "border-green-500/30 bg-green-500/5" },
  caution: { label: "Send with caution", icon: ShieldAlert, tone: "text-amber-400", ring: "border-amber-500/30 bg-amber-500/5" },
  not_ready: { label: "Not ready to send", icon: ShieldX, tone: "text-red-400", ring: "border-red-500/30 bg-red-500/5" },
} as const;

export function EstimateReadinessPanel({ lineItems, projectType, checklist }: Props) {
  const [open, setOpen] = useState(false);
  const r = useMemo(
    () => assessReadiness({ lineItems, projectType, checklist }),
    [lineItems, projectType, checklist]
  );
  if (r.totalPrice <= 0) return null;

  const v = VERDICT[r.verdict];
  const Icon = v.icon;
  const marginDrop = r.plannedMarginPct - r.riskAdjustedMarginPct;

  return (
    <Card className={cn("border", v.ring)}>
      <CardContent className="p-4 space-y-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-3 text-left"
          aria-expanded={open}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={cn("h-5 w-5 shrink-0", v.tone)} />
            <span className={cn("font-semibold", v.tone)}>{v.label}</span>
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
              {r.reasons[0] ?? "All sub trades quoted, triggers covered."}
            </span>
          </div>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Unquoted sub work" value={`${Math.round(r.unquotedShare * 100)}%`} sub={fmt(r.unquotedPrice)} warn={r.unquotedShare > 0.15} />
          <Stat label="Planned margin" value={`${r.plannedMarginPct.toFixed(1)}%`} />
          <Stat
            label="Risk-adjusted margin"
            value={`${r.riskAdjustedMarginPct.toFixed(1)}%`}
            sub={marginDrop > 0.05 ? `−${marginDrop.toFixed(1)} pts` : undefined}
            warn={r.riskAdjustedMarginPct < 20}
          />
          <Stat label="Open triggers" value={String(r.openTriggers.length)} sub={r.unansweredCount > 0 ? `${r.unansweredCount} unanswered` : undefined} warn={r.openTriggers.length > 0} />
        </div>

        {open && (
          <div className="space-y-3 pt-1 border-t border-border/60">
            {r.reasons.length > 0 && (
              <ul className="text-sm space-y-1 pt-3">
                {r.reasons.map((x) => (
                  <li key={x} className="flex gap-2"><span className="text-muted-foreground">•</span><span>{x}</span></li>
                ))}
              </ul>
            )}

            {r.byTrade.length > 0 && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Carried, not quoted</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {r.byTrade.map((t) => (
                        <tr key={t.trade} className="border-t border-border/40">
                          <td className="py-1.5 pr-3 capitalize">{t.trade}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(t.unquotedPrice)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">runs +{Math.round(t.overrunPct * 100)}%</td>
                          <td className="py-1.5 text-right tabular-nums text-amber-400">−{fmt(t.expectedOverrun)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Overrun is what that trade has cost above its carry on closed jobs. Get the quote and the line drops off this list.
                </p>
              </div>
            )}

            {r.openTriggers.length > 0 && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Walkthrough triggers with no allowance</div>
                <ul className="text-sm space-y-1">
                  {r.openTriggers.map((t) => (
                    <li key={t.key} className="flex gap-2">
                      <span className={cn("shrink-0 text-xs mt-0.5 rounded px-1.5 py-0.5", t.answer === "yes" ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400")}>
                        {t.answer === "yes" ? "found" : "unknown"}
                      </span>
                      <span>{t.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground mt-1">
                  Open the walkthrough and press &ldquo;Add allowance lines&rdquo; so each of these is priced on the proposal.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums leading-tight", warn ? "text-amber-400" : "")}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}
