"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Calculator,
  TrendingUp,
  Flame,
  Percent,
  DollarSign,
  Save,
  AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";

interface OverheadCalc {
  id: string;
  period_start: string;
  period_end: string;
  days_elapsed: number;
  months_elapsed: string;
  qb_revenue: string;
  qb_opex: string;
  qb_cogs: string;
  field_labor_ytd: string;
  admin_payroll_monthly: string;
  bbp_reclass: string;
  true_overhead_ytd: string;
  true_direct_cost_ytd: string;
  adjusted_gross_profit_ytd: string;
  implied_net_income_ytd: string;
  monthly_overhead_burn: string;
  overhead_annualized: string;
  revenue_annualized: string;
  overhead_pct_of_revenue: string;
  overhead_markup_rate: string;
  adjusted_gross_margin: string;
  recommended_bid_markup_on_direct_cost: string;
  payroll_tax_rate: string;
  target_profit_margin: string;
  notes: string | null;
}

interface OverheadConfig {
  id: string;
  period_start: string;
  period_end: string;
  qb_revenue: string;
  qb_opex: string;
  qb_cogs: string;
  field_labor_ytd: string;
  admin_payroll_monthly: string;
  bbp_reclass: string;
  payroll_tax_rate: string;
  target_profit_margin: string;
  notes: string | null;
}

interface Props {
  latestCalc: OverheadCalc | null;
  latestConfig: OverheadConfig | null;
  history: OverheadCalc[];
}

const fmtMoney = (v: string | number, opts?: { cents?: boolean }) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts?.cents ? 2 : 0,
    maximumFractionDigits: opts?.cents ? 2 : 0,
  });
};
const fmtPct = (v: string | number, digits = 2) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
};

export function OverheadDashboard({ latestCalc, latestConfig, history }: Props) {
  if (!latestCalc || !latestConfig) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold">No overhead period configured</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Seed a row in <code className="text-xs">overhead_config</code> to see the dashboard.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <HeadlineCards calc={latestCalc} />
      <BreakdownTable calc={latestCalc} />
      <BidCalculator calc={latestCalc} />
      <EditableInputs config={latestConfig} />
      {history.length > 1 && <HistoryTable history={history} />}
    </>
  );
}

/* ── Section 1: Headline Cards ── */

function HeadlineCards({ calc }: { calc: OverheadCalc }) {
  const cards = [
    {
      label: "True Overhead YTD",
      value: fmtMoney(calc.true_overhead_ytd),
      sub: `${fmtPct(calc.overhead_pct_of_revenue)} of revenue`,
      icon: Flame,
      color: "text-orange-500",
      bg: "bg-orange-500/10",
    },
    {
      label: "Monthly Burn",
      value: fmtMoney(calc.monthly_overhead_burn),
      sub: `Annualized: ${fmtMoney(calc.overhead_annualized)}`,
      icon: TrendingUp,
      color: "text-rose-500",
      bg: "bg-rose-500/10",
    },
    {
      label: "Overhead Markup Rate",
      value: fmtPct(calc.overhead_markup_rate),
      sub: "Overhead ÷ Direct Cost",
      icon: Percent,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: "Recommended Bid Markup",
      value: fmtPct(calc.recommended_bid_markup_on_direct_cost),
      sub: `Target profit ${fmtPct(calc.target_profit_margin, 0)}`,
      icon: Calculator,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <Card key={c.label} className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className={`p-2 rounded-lg ${c.bg}`}>
              <c.icon className={`h-5 w-5 ${c.color}`} />
            </div>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              {c.label}
            </span>
          </div>
          <div className="text-2xl font-bold">{c.value}</div>
          <div className="text-xs text-muted-foreground mt-1">{c.sub}</div>
        </Card>
      ))}
    </div>
  );
}

/* ── Section 2: Full Breakdown Table ── */

function BreakdownTable({ calc }: { calc: OverheadCalc }) {
  const rows: { label: string; value: string; bold?: boolean; indent?: boolean; note?: string }[] = [
    { label: "Period", value: `${calc.period_start} → ${calc.period_end}`, bold: true },
    { label: "Days elapsed", value: `${calc.days_elapsed} (${Number(calc.months_elapsed).toFixed(2)} mo)` },
    { label: "—", value: "" },
    { label: "QuickBooks Revenue", value: fmtMoney(calc.qb_revenue, { cents: true }), bold: true },
    { label: "QuickBooks COGS (as reported)", value: fmtMoney(calc.qb_cogs, { cents: true }) },
    { label: "QuickBooks OpEx", value: fmtMoney(calc.qb_opex, { cents: true }) },
    { label: "—", value: "" },
    { label: "Reclassifications", value: "", bold: true },
    { label: "+ Field labor YTD (moved to Direct Cost)", value: fmtMoney(calc.field_labor_ytd, { cents: true }), indent: true, note: "From ADP" },
    { label: "+ BBP reclassified to Overhead", value: fmtMoney(calc.bbp_reclass, { cents: true }), indent: true, note: "Penney-owned mgmt entity" },
    { label: "Admin payroll (monthly)", value: fmtMoney(calc.admin_payroll_monthly, { cents: true }), indent: true },
    { label: "—", value: "" },
    { label: "True Direct Cost YTD", value: fmtMoney(calc.true_direct_cost_ytd, { cents: true }), bold: true, note: "COGS – field labor + BBP out" },
    { label: "True Overhead YTD", value: fmtMoney(calc.true_overhead_ytd, { cents: true }), bold: true, note: "OpEx – admin payroll + BBP in" },
    { label: "Adjusted Gross Profit YTD", value: fmtMoney(calc.adjusted_gross_profit_ytd, { cents: true }), bold: true },
    { label: "Implied Net Income YTD", value: fmtMoney(calc.implied_net_income_ytd, { cents: true }), bold: true, note: "Should match QB P&L net" },
    { label: "—", value: "" },
    { label: "Overhead as % of Revenue", value: fmtPct(calc.overhead_pct_of_revenue) },
    { label: "Adjusted Gross Margin", value: fmtPct(calc.adjusted_gross_margin) },
    { label: "Overhead Markup Rate", value: fmtPct(calc.overhead_markup_rate), note: "Apply to direct cost to cover overhead" },
    { label: "Target Profit Margin", value: fmtPct(calc.target_profit_margin) },
    { label: "Recommended Bid Markup on Direct Cost", value: fmtPct(calc.recommended_bid_markup_on_direct_cost), bold: true, note: "Overhead markup + target profit" },
  ];

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <DollarSign className="h-5 w-5 text-amber-500" />
        Full Breakdown
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => {
              if (r.label === "—") {
                return (
                  <tr key={i}>
                    <td colSpan={3} className="py-1">
                      <div className="h-px bg-border" />
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={i} className={r.bold ? "font-semibold" : ""}>
                  <td className={`py-1.5 ${r.indent ? "pl-6" : ""}`}>{r.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.value}</td>
                  <td className="py-1.5 pl-4 text-xs text-muted-foreground">{r.note || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {calc.notes && (
        <div className="mt-4 pt-4 border-t text-xs text-muted-foreground">
          <span className="font-semibold">Notes:</span> {calc.notes}
        </div>
      )}
    </Card>
  );
}

/* ── Section 3: Bid Calculator ── */

function BidCalculator({ calc }: { calc: OverheadCalc }) {
  const [directCost, setDirectCost] = useState<string>("10000");
  const markup = Number(calc.recommended_bid_markup_on_direct_cost);
  const overheadMarkup = Number(calc.overhead_markup_rate);
  const targetProfit = Number(calc.target_profit_margin);

  const { dc, bid, overheadAllocated, profit } = useMemo(() => {
    const dc = Number(directCost) || 0;
    const bid = dc * (1 + markup);
    const overheadAllocated = dc * overheadMarkup;
    const profit = bid - dc - overheadAllocated;
    return { dc, bid, overheadAllocated, profit };
  }, [directCost, markup, overheadMarkup]);

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Calculator className="h-5 w-5 text-emerald-500" />
        Bid Calculator
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div>
            <Label htmlFor="direct-cost">Direct cost of job</Label>
            <Input
              id="direct-cost"
              type="number"
              value={directCost}
              onChange={(e) => setDirectCost(e.target.value)}
              placeholder="10000"
              className="mt-1 text-lg tabular-nums"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Subs + materials + field labor for this job
            </p>
          </div>
          <div className="text-xs text-muted-foreground space-y-1 pt-2">
            <div>+ Overhead markup: {fmtPct(overheadMarkup)} → {fmtMoney(overheadAllocated)}</div>
            <div>+ Target profit: {fmtPct(targetProfit, 0)} of bid</div>
            <div className="font-semibold text-foreground pt-1">
              = Bid markup: {fmtPct(markup)}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <div className="text-xs uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Minimum Bid
            </div>
            <div className="text-3xl font-bold tabular-nums mt-1">{fmtMoney(bid, { cents: true })}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="text-xs text-muted-foreground">Overhead Absorbed</div>
              <div className="font-semibold tabular-nums">{fmtMoney(overheadAllocated)}</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="text-xs text-muted-foreground">Est. Profit</div>
              <div className="font-semibold tabular-nums">{fmtMoney(profit)}</div>
            </div>
          </div>
          {dc > 0 && (
            <div className="text-xs text-muted-foreground">
              On ${dc.toLocaleString()} of direct cost, this bid absorbs {fmtMoney(overheadAllocated)} of
              overhead and returns {fmtMoney(profit)} to the company.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ── Section 4: Editable Inputs ── */

function EditableInputs({ config }: { config: OverheadConfig }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [form, setForm] = useState({
    period_start: config.period_start,
    period_end: config.period_end,
    qb_revenue: config.qb_revenue,
    qb_opex: config.qb_opex,
    qb_cogs: config.qb_cogs,
    field_labor_ytd: config.field_labor_ytd,
    admin_payroll_monthly: config.admin_payroll_monthly,
    bbp_reclass: config.bbp_reclass,
    payroll_tax_rate: config.payroll_tax_rate,
    target_profit_margin: config.target_profit_margin,
    notes: config.notes ?? "",
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function onSave() {
    setSaveState("saving");
    setErrorMsg(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("overhead_config")
      .update({
        period_start: form.period_start,
        period_end: form.period_end,
        qb_revenue: form.qb_revenue,
        qb_opex: form.qb_opex,
        qb_cogs: form.qb_cogs,
        field_labor_ytd: form.field_labor_ytd,
        admin_payroll_monthly: form.admin_payroll_monthly,
        bbp_reclass: form.bbp_reclass,
        payroll_tax_rate: form.payroll_tax_rate,
        target_profit_margin: form.target_profit_margin,
        notes: form.notes || null,
      })
      .eq("id", config.id);

    if (error) {
      setSaveState("error");
      setErrorMsg(error.message);
      return;
    }
    setSaveState("saved");
    startTransition(() => router.refresh());
    setTimeout(() => setSaveState("idle"), 2000);
  }

  const fields: { key: keyof typeof form; label: string; type: "money" | "pct" | "date" | "text"; hint?: string }[] = [
    { key: "period_start", label: "Period start", type: "date" },
    { key: "period_end", label: "Period end", type: "date" },
    { key: "qb_revenue", label: "QB Revenue (Construction Income)", type: "money" },
    { key: "qb_cogs", label: "QB COGS", type: "money" },
    { key: "qb_opex", label: "QB OpEx", type: "money" },
    { key: "field_labor_ytd", label: "Field Labor YTD", type: "money", hint: "Moves from OpEx → Direct Cost" },
    { key: "admin_payroll_monthly", label: "Admin Payroll / month", type: "money" },
    { key: "bbp_reclass", label: "BBP reclass (COGS → Overhead)", type: "money" },
    { key: "payroll_tax_rate", label: "Payroll tax rate", type: "pct", hint: "e.g. 0.177 = 17.7%" },
    { key: "target_profit_margin", label: "Target profit margin", type: "pct", hint: "e.g. 0.15 = 15%" },
  ];

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Inputs</h2>
        {saveState === "saved" && <Badge className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">Saved</Badge>}
        {saveState === "error" && <Badge variant="destructive">Error</Badge>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {fields.map((f) => (
          <div key={f.key}>
            <Label htmlFor={f.key}>{f.label}</Label>
            <Input
              id={f.key}
              type={f.type === "date" ? "date" : "number"}
              step={f.type === "money" ? "0.01" : f.type === "pct" ? "0.0001" : undefined}
              value={form[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              className="mt-1 tabular-nums"
            />
            {f.hint && <p className="text-xs text-muted-foreground mt-1">{f.hint}</p>}
          </div>
        ))}
      </div>

      <div className="mt-4">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          className="mt-1"
          rows={2}
        />
      </div>

      {errorMsg && (
        <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-600 dark:text-red-400">
          {errorMsg}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button onClick={onSave} disabled={saveState === "saving" || isPending}>
          <Save className="h-4 w-4 mr-2" />
          {saveState === "saving" ? "Saving…" : "Save & recalc"}
        </Button>
      </div>
    </Card>
  );
}

/* ── Section 5: History Table ── */

function HistoryTable({ history }: { history: OverheadCalc[] }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold mb-4">History</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
              <th className="py-2 pr-4">Period</th>
              <th className="py-2 pr-4 text-right">Revenue</th>
              <th className="py-2 pr-4 text-right">Overhead</th>
              <th className="py-2 pr-4 text-right">Net Income</th>
              <th className="py-2 pr-4 text-right">Monthly Burn</th>
              <th className="py-2 pr-4 text-right">Bid Markup</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-b last:border-0">
                <td className="py-2 pr-4">{h.period_start} → {h.period_end}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{fmtMoney(h.qb_revenue)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{fmtMoney(h.true_overhead_ytd)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{fmtMoney(h.implied_net_income_ytd)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{fmtMoney(h.monthly_overhead_burn)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{fmtPct(h.recommended_bid_markup_on_direct_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
