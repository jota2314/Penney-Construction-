"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { BillDrop } from "@/components/invoices/bill-drop";
import { DepositCapture } from "@/components/field-feed/deposit-capture";
import { PCC_TOKENS } from "@/components/field-feed/tokens";
import { logTotals, type LogTransaction } from "@/lib/finance/daily-log";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
const monthLabel = (month: string) => new Date(`${month}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
function moveMonth(month: string, offset: number) {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + offset, 1));
  return date.toISOString().slice(0,7);
}
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const control = `min-h-11 rounded-lg border bg-background px-3 py-2 text-sm ${focusRing}`;
const differenceColor = (amount: number) => amount < 0 ? "text-rose-600 dark:text-rose-400" : amount > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-foreground";

export function FinancialDailyLog(props: { records: LogTransaction[]; month: string; today: string; failed: boolean }) {
  // A month navigation resets local filters so a previous day cannot hide it.
  return <LogContents key={props.month} {...props} />;
}

function LogContents({ records, month, today, failed }: { records: LogTransaction[]; month: string; today: string; failed: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState("all");
  const [job, setJob] = useState("all");
  const [query, setQuery] = useState("");
  const [day, setDay] = useState("");
  const [entry, setEntry] = useState<"income" | "expense" | null>(null);
  const activeFilters = Number(kind !== "all") + Number(job !== "all") + Number(Boolean(day));
  const hasFilters = activeFilters > 0 || Boolean(query);
  function clearFilters() { setKind("all"); setJob("all"); setQuery(""); setDay(""); }
  const jobs = [...new Map(records.flatMap(r => r.projects).map(p => [p.id,p])).values()].sort((a,b) => a.label.localeCompare(b.label));
  const needle = query.trim().toLowerCase();
  const filtered = records.filter(r => (kind === "all" || r.kind === kind)
    && (job === "all" || (job === "unassigned" ? !r.projects.length : r.projects.some(p => p.id === job)))
    && (!day || r.date === day)
    && (!needle || [r.name,r.description,r.reference,...r.projects.map(p => p.label)].join(" ").toLowerCase().includes(needle)));
  const totals = logTotals(filtered.filter(r => r.date));
  const largeTotals = Math.max(Math.abs(totals.income), Math.abs(totals.expenses), Math.abs(totals.difference)) >= 1_000_000;
  const groups = new Map<string, LogTransaction[]>();
  for (const r of filtered) {
    const date = r.date || "undated";
    groups.set(date, [...(groups.get(date) ?? []),r]);
  }
  const undated = records.filter(r => !r.date).length;
  const workspaceHref = (panel: string, id?: string) => `/finances/daily-log?month=${month}&panel=${panel}${id ? `&id=${id}` : ""}`;
  const transactionHref = (r: LogTransaction) => workspaceHref(r.kind, r.recordIds[0]);
  return <>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Financial Daily Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your income and expenses, day by day.</p>
      </div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
        <button className={`${control} font-medium`} onClick={() => setEntry(entry === "income" ? null : "income")}>+ Record income</button>
        <button className={`${control} border-amber-500/40 bg-amber-500/10 font-medium text-amber-600 dark:text-amber-400`} onClick={() => setEntry(entry === "expense" ? null : "expense")}>+ Add expense</button>
      </div>
    </div>
    <nav aria-label="Financial work" className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-medium">
      <Link scroll={false} className={`inline-flex min-h-11 items-center gap-1 hover:text-amber-600 ${focusRing}`} href={workspaceHref("bills")}>Bills to pay <ArrowUpRight aria-hidden="true" className="h-3 w-3" /></Link>
      <Link scroll={false} className={`inline-flex min-h-11 items-center gap-1 hover:text-amber-600 ${focusRing}`} href={workspaceHref("review-expenses")}>Review expenses <ArrowUpRight aria-hidden="true" className="h-3 w-3" /></Link>
      <Link scroll={false} className={`inline-flex min-h-11 items-center gap-1 hover:text-amber-600 ${focusRing}`} href={workspaceHref("review-income")}>Review income <ArrowUpRight aria-hidden="true" className="h-3 w-3" /></Link>
    </nav>
    {entry && <section style={PCC_TOKENS} className="rounded-xl border bg-[#16140F] p-4 text-[#F5F1EA]" aria-label={entry === "income" ? "Record income" : "Add expense"}>
      <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">{entry === "income" ? "Record income" : "Add a receipt or bill"}</h2><button className="text-sm text-muted-foreground" onClick={() => setEntry(null)}>Close</button></div>
      {entry === "expense" ? <BillDrop onFiled={() => router.refresh()} /> : <DepositCapture />}
    </section>}

    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto">
        <Link className={control} aria-label="Previous month" href={`?month=${moveMonth(month,-1)}`}><ChevronLeft className="h-5 w-5" /></Link>
        <span className="min-w-36 text-center font-semibold">{monthLabel(month)}</span>
        <Link className={control} aria-label="Next month" href={`?month=${moveMonth(month,1)}`}><ChevronRight className="h-5 w-5" /></Link>
      </div>
      <details className="group/month w-full sm:w-auto">
        <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden ${focusRing}`}>Choose month <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 transition-transform group-open/month:rotate-180" /></summary>
        <form className="mt-2 flex flex-wrap gap-2" action="/finances/daily-log">
          <input aria-label="Choose month" type="month" name="month" defaultValue={month} min="1900-01" max="2200-12" className={`${control} min-w-0 flex-1`} required />
          <button className={control}>Go</button>
          <Link className={`${control} inline-flex items-center`} href={`?month=${today.slice(0,7)}`}>This month</Link>
        </form>
      </details>
    </div>

    {failed ? <div role="alert" className="rounded-xl border border-red-500/30 p-6">
      <h2 className="font-semibold">The daily log couldn’t load.</h2>
      <p className="mt-1 text-sm text-muted-foreground">Income or expense records are unavailable. Totals are hidden until both load.</p>
      <button onClick={() => router.refresh()} className={`${control} mt-4`}>Try again</button>
    </div> : <>
      <section aria-label="Selected activity totals" className={`grid overflow-hidden rounded-xl border bg-card sm:grid-cols-3 ${largeTotals ? "grid-cols-1" : "grid-cols-2"}`}>
        {[
          { label: "Income received", value: totals.income, color: "text-emerald-700 dark:text-emerald-400", layout: largeTotals ? "border-b sm:border-b-0 sm:border-r" : "border-r" },
          { label: "Expenses & bills", value: totals.expenses, color: "text-amber-700 dark:text-amber-400", layout: "sm:border-r" },
          { label: "Income less expenses", value: totals.difference, color: differenceColor(totals.difference), layout: `${largeTotals ? "" : "col-span-2"} border-t bg-muted/25 sm:col-span-1 sm:border-t-0` },
        ].map(tile => <div key={tile.label} className={`min-w-0 p-3 sm:p-4 ${tile.layout}`}><div className="text-[11px] font-medium text-muted-foreground">{tile.label}</div><div className={`mt-1 break-words text-lg font-semibold tracking-tight tabular-nums sm:text-2xl ${tile.color}`}>{money(tile.value)}</div></div>)}
      </section>
      <div className="-mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
        <details><summary className={`w-fit cursor-pointer py-1 ${focusRing}`}>About these totals · {hasFilters ? "filtered activity" : monthLabel(month)}</summary>
          <p className="mt-1 max-w-3xl">Totals follow your filters. Expenses use the bill date and include unpaid bills and card purchases; credits reduce expenses. This is recorded activity, not a bank balance or profit report. QuickBooks imports and internal labor allocations are excluded.</p>
        </details>
        {totals.review > 0 && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">{totals.review} transaction{totals.review === 1 ? " needs" : "s need"} review · excluded from totals.</p>}
        {undated > 0 && <p>{undated} undated transaction{undated === 1 ? "" : "s"} across all dates appear below when no day is selected, excluded from totals.</p>}
      </div>

      <div className="space-y-3">
        <label className="relative block text-muted-foreground"><span className="sr-only">Search</span><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4" /><input className={`${control} w-full pl-9 text-foreground`} placeholder="Search name, job or reference…" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <details className="group/filters rounded-xl border bg-card">
          <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-xs font-medium [&::-webkit-details-marker]:hidden ${focusRing}`}><SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-muted-foreground" />Filters{activeFilters > 0 && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">{activeFilters} active</span>}<ChevronDown aria-hidden="true" className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open/filters:rotate-180" /></summary>
          <div className="grid gap-3 border-t p-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Transaction type
          <select className={`${control} text-foreground`} value={kind} onChange={e => setKind(e.target.value)}><option value="all">All transactions</option><option value="income">Income</option><option value="expense">Expenses</option></select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Job
          <select aria-label="Job" className={`${control} w-full text-foreground`} value={job} onChange={e => setJob(e.target.value)}><option value="all">All jobs</option><option value="unassigned">No job assigned</option>{jobs.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Specific day
          <input type="date" className={`${control} w-full text-foreground`} min={`${month}-01`} max={`${month}-${new Date(Number(month.slice(0,4)), Number(month.slice(5,7)),0).getDate()}`} value={day} onChange={e => setDay(e.target.value)} />
        </label>
          </div>
        </details>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs text-muted-foreground"><span aria-live="polite">{filtered.length} transaction{filtered.length === 1 ? "" : "s"} · newest first</span>{hasFilters && <button className={`min-h-11 px-2 font-medium hover:text-foreground ${focusRing}`} onClick={clearFilters}>Clear filters</button>}</div>
      {filtered.length === 0 && <div className="rounded-xl border border-dashed p-10 text-center"><h2 className="font-medium">No transactions for this selection</h2><p className="mt-2 text-sm text-muted-foreground">Choose another month or clear your filters. New entries appear here after they are saved.</p></div>}
      {[...groups].map(([date, rows]) => {
        const total = logTotals(rows);
        const largeDayTotal = Math.max(Math.abs(total.income), Math.abs(total.expenses), Math.abs(total.difference)) >= 1_000_000;
        return <section key={date} aria-label={date === "undated" ? "Date needed" : dayLabel(date)} className="overflow-hidden rounded-xl border bg-card">
          <header className="border-b bg-muted/30">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 px-3 pb-3 pt-4 sm:px-4"><h2 className="text-sm font-semibold">{date === "undated" ? "Date needed" : `${date === today ? "Today · " : ""}${dayLabel(date)}`}</h2><p className="text-[11px] text-muted-foreground">{rows.length} transaction{rows.length === 1 ? "" : "s"}</p></div>
            {date !== "undated" && <dl className={`grid border-t ${largeDayTotal ? "grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0" : "grid-cols-3 divide-x py-3"}`}>
              {[
                { label: "Income", amount: total.income, color: "text-emerald-700 dark:text-emerald-400" },
                { label: "Expenses", amount: total.expenses, color: "text-amber-700 dark:text-amber-400" },
                { label: "Difference", amount: total.difference, color: differenceColor(total.difference) },
              ].map(item => <div key={item.label} className={`min-w-0 px-2 sm:px-4 ${largeDayTotal ? "flex items-baseline justify-between gap-3 py-2 sm:block" : ""}`}><dt className="text-[10px] text-muted-foreground sm:text-xs">{item.label}</dt><dd className={`mt-1 break-words text-xs font-semibold tabular-nums sm:text-sm ${item.color}`}>{money(item.amount)}</dd></div>)}
            </dl>}
            {date !== "undated" && total.review > 0 && <p className="px-3 pb-3 text-[11px] text-amber-700 dark:text-amber-400 sm:px-4">{total.review} awaiting review · excluded from this day’s totals</p>}
          </header>
          <div className="divide-y">{rows.map(r => <article key={r.id}>
            <details className="group/transaction">
              <summary className={`flex cursor-pointer list-none items-start gap-2.5 px-3 py-4 transition-colors hover:bg-muted/25 focus-visible:ring-inset sm:gap-3 sm:px-4 [&::-webkit-details-marker]:hidden ${focusRing}`}>
                <span aria-hidden="true" className={`mt-0.5 shrink-0 rounded-lg p-1.5 sm:p-2 ${r.kind === "income" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>{r.kind === "income" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span title={r.name} className="line-clamp-2 min-w-0 break-words text-[13px] font-semibold leading-5 sm:text-sm">{r.name}</span>
                    <span className={`max-w-[55%] shrink-0 break-words text-right text-[13px] font-semibold leading-5 tabular-nums sm:text-sm ${r.kind === "income" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{r.amount === null ? <span className="text-xs text-amber-700 dark:text-amber-400">Amount needs review</span> : money(r.amount)}</span>
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground" title={r.projects.map(p => p.label).join(" · ")}>{r.projects.length ? r.projects.map(p => p.label).join(" · ") : "No job assigned"}</span>
                  <span className="mt-2 flex items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground sm:text-[11px]">
                      <span>{r.kind === "income" ? "Income" : r.amount !== null && r.amount < 0 ? "Expense credit" : "Expense"}</span>
                      <span className={`rounded-full px-2 py-0.5 font-medium ${r.status === "Paid" || r.status === "Received" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>{r.status}</span>
                    </span>
                    <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/transaction:rotate-180" />
                  </span>
                  {r.review && <span className="mt-2 block text-[11px] font-medium text-amber-700 dark:text-amber-400">Needs review · excluded from totals</span>}
                  {r.submissions > 1 && <span className="mt-1 block text-[11px] text-amber-700 dark:text-amber-400">{r.submissions} submissions · possible duplicate</span>}
                  <span className="sr-only">Transaction details</span>
                </span>
              </summary>
              <div className="space-y-3 border-t border-dashed bg-muted/15 px-4 py-4 text-xs sm:pl-[60px]">
                <h3 className="break-words font-semibold">{r.name}</h3>
                {r.description && <p className="break-words leading-relaxed">{r.description}</p>}
                {r.projects.length > 0 && <div className="flex flex-col items-start gap-1">{r.projects.map(p => <Link key={p.id} className={`inline-flex min-h-11 max-w-full items-center gap-1 text-amber-700 hover:underline dark:text-amber-400 ${focusRing}`} href={`/projects/${p.id}?tab=finances`}><span className="min-w-0 break-words">{p.label}</span><ArrowUpRight aria-hidden="true" className="h-3 w-3 shrink-0" /></Link>)}</div>}
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                  {r.reference && <><dt className="text-muted-foreground">Reference</dt><dd className="break-words">{r.reference}</dd></>}
                  {r.method && <><dt className="text-muted-foreground">Method</dt><dd className="break-words capitalize">{r.method.replaceAll("_", " ")}</dd></>}
                  <dt className="text-muted-foreground">Source</dt><dd className="break-words capitalize">{r.source.replaceAll("_", " ")}</dd>
                </dl>
                {r.allocations > 1 && <p className="text-muted-foreground">{r.allocations} allocations · full bill shown once</p>}
                {r.projects.length > 1 && <p className="text-muted-foreground">Shared across jobs; the full bill amount is shown.</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link scroll={false} href={transactionHref(r)} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-500/20 dark:text-amber-400 ${focusRing}`}>{r.kind === "expense" ? "Manage expense" : "Manage payment"}<ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" /></Link>
                  {r.kind === "expense" && <Link scroll={false} href={workspaceHref("review-expenses", r.recordIds[0])} className={`inline-flex min-h-11 items-center rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted ${focusRing}`}>Review & assign</Link>}
                </div>
                {r.kind === "expense" && <p className="text-[11px] text-muted-foreground">Open Manage expense for bill details, attachments and payment controls.</p>}
              </div>
            </details>
          </article>)}</div>
        </section>;
      })}
    </>}
  </>;
}
