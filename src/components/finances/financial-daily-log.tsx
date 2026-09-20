"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { BillDrop } from "@/components/invoices/bill-drop";
import { DepositCapture } from "@/components/field-feed/deposit-capture";
import { PCC_TOKENS } from "@/components/field-feed/tokens";
import { logTotals, type LogTransaction } from "@/lib/finance/daily-log";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const monthLabel = (month: string) => new Date(`${month}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
function moveMonth(month: string, offset: number) {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + offset, 1));
  return date.toISOString().slice(0,7);
}
const control = "rounded-lg border bg-background px-3 py-2 text-sm min-h-10";

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
  const jobs = [...new Map(records.flatMap(r => r.projects).map(p => [p.id,p])).values()].sort((a,b) => a.label.localeCompare(b.label));
  const needle = query.trim().toLowerCase();
  const filtered = records.filter(r => (kind === "all" || r.kind === kind)
    && (job === "all" || (job === "unassigned" ? !r.projects.length : r.projects.some(p => p.id === job)))
    && (!day || r.date === day)
    && (!needle || [r.name,r.description,r.reference,...r.projects.map(p => p.label)].join(" ").toLowerCase().includes(needle)));
  const totals = logTotals(filtered.filter(r => r.date));
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
        <p className="mt-1 text-sm text-muted-foreground">Record, review and manage your income and expenses right here.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={`${control} font-medium`} onClick={() => setEntry(entry === "income" ? null : "income")}>+ Record income</button>
        <button className={`${control} border-amber-500/40 bg-amber-500/10 font-medium text-amber-600 dark:text-amber-400`} onClick={() => setEntry(entry === "expense" ? null : "expense")}>+ Add expense</button>
      </div>
    </div>
    <nav aria-label="Financial work" className="flex flex-wrap gap-2">
      <Link scroll={false} className={control} href={workspaceHref("bills")}>Bills to pay</Link>
      <Link scroll={false} className={control} href={workspaceHref("review-expenses")}>Review expenses</Link>
      <Link scroll={false} className={control} href={workspaceHref("review-income")}>Review income</Link>
    </nav>
    {entry && <section style={PCC_TOKENS} className="rounded-xl border bg-[#16140F] p-4 text-[#F5F1EA]" aria-label={entry === "income" ? "Record income" : "Add expense"}>
      <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">{entry === "income" ? "Record income" : "Add a receipt or bill"}</h2><button className="text-sm text-muted-foreground" onClick={() => setEntry(null)}>Close</button></div>
      {entry === "expense" ? <BillDrop onFiled={() => router.refresh()} /> : <DepositCapture />}
    </section>}

    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Link className={control} aria-label="Previous month" href={`?month=${moveMonth(month,-1)}`}><ChevronLeft className="h-5 w-5" /></Link>
        <span className="min-w-36 text-center font-semibold">{monthLabel(month)}</span>
        <Link className={control} aria-label="Next month" href={`?month=${moveMonth(month,1)}`}><ChevronRight className="h-5 w-5" /></Link>
      </div>
      <form className="flex flex-wrap gap-2" action="/finances/daily-log">
        <input aria-label="Choose month" type="month" name="month" defaultValue={month} min="1900-01" max="2200-12" className={control} required />
        <button className={control}>Go</button>
        <Link className={control} href={`?month=${today.slice(0,7)}`}>This month</Link>
      </form>
    </div>

    {failed ? <div role="alert" className="rounded-xl border border-red-500/30 p-6">
      <h2 className="font-semibold">The daily log couldn’t load.</h2>
      <p className="mt-1 text-sm text-muted-foreground">Income or expense records are unavailable. Totals are hidden until both load.</p>
      <button onClick={() => router.refresh()} className={`${control} mt-4`}>Try again</button>
    </div> : <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Income received", value: totals.income, color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Expenses & bills", value: totals.expenses, color: "text-amber-600 dark:text-amber-400" },
          { label: "Income less expenses", value: totals.difference, color: "text-foreground" },
        ].map(tile => <div key={tile.label} className="rounded-xl border bg-card p-4"><div className="text-xs font-medium text-muted-foreground">{tile.label}</div><div className={`mt-2 text-2xl font-semibold tabular-nums ${tile.color}`}>{money(tile.value)}</div></div>)}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Totals follow your filters. Expenses use the bill date and include unpaid bills and card purchases; credits reduce expenses. This is recorded activity, not a bank balance or profit report. QuickBooks imports and internal labor allocations are excluded.
        {totals.review > 0 && <span className="block mt-1 text-amber-600 dark:text-amber-400">{totals.review} transaction{totals.review === 1 ? " needs" : "s need"} review and {totals.review === 1 ? "is" : "are"} excluded from totals.</span>}
        {undated > 0 && <span className="block mt-1">{undated} undated transaction{undated === 1 ? "" : "s"} across all dates appear below when no day is selected, excluded from totals.</span>}
      </p>

      <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Search
          <span className="relative"><Search className="absolute left-3 top-3 h-4 w-4" /><input className={`${control} w-full pl-9 text-foreground`} placeholder="Name, job, invoice…" value={query} onChange={e => setQuery(e.target.value)} /></span>
        </label>
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
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{filtered.length} transaction{filtered.length === 1 ? "" : "s"} · newest day first</span><button className="min-h-9 px-2 hover:text-foreground" onClick={() => { setKind("all"); setJob("all"); setQuery(""); setDay(""); }}>Clear filters</button></div>
      {filtered.length === 0 && <div className="rounded-xl border border-dashed p-10 text-center"><h2 className="font-medium">No transactions for this selection</h2><p className="mt-2 text-sm text-muted-foreground">Choose another month or clear your filters. New entries appear here after they are saved.</p></div>}
      {[...groups].map(([date, rows]) => {
        const total = logTotals(rows);
        return <section key={date} className="overflow-hidden rounded-xl border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
            <div><h2 className="font-semibold">{date === "undated" ? "Date needed" : `${date === today ? "Today · " : ""}${dayLabel(date)}`}</h2><p className="mt-0.5 text-xs text-muted-foreground">{rows.length} transaction{rows.length === 1 ? "" : "s"}</p></div>
            {date !== "undated" && <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums"><span className="text-emerald-600 dark:text-emerald-400">Income {money(total.income)}</span><span className="text-amber-600 dark:text-amber-400">Expenses {money(total.expenses)}</span><span>Difference {money(total.difference)}</span></div>}
          </header>
          <div className="divide-y">{rows.map(r => <article key={r.id} className="p-4">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 shrink-0 rounded-lg p-2 ${r.kind === "income" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>{r.kind === "income" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"><Link scroll={false} href={transactionHref(r)} className="break-words text-sm font-semibold hover:underline">{r.name}</Link><span className={`shrink-0 text-sm font-semibold tabular-nums ${r.kind === "income" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{r.amount === null ? "Amount needs review" : money(r.amount)}</span></div>
                <div className="mt-1 text-xs text-muted-foreground">{r.projects.length ? r.projects.map(p => <Link key={p.id} className="mr-2 inline-block hover:underline" href={`/projects/${p.id}?tab=finances`}>{p.label}</Link>) : "No job assigned"}</div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded bg-muted px-2 py-0.5">{r.kind === "income" ? "Income" : r.amount !== null && r.amount < 0 ? "Expense credit" : "Expense"}</span>
                  <span className="rounded bg-muted px-2 py-0.5">{r.status}</span>
                  {r.review && <span className="rounded bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-400">Needs review · excluded from totals</span>}
                  {r.submissions > 1 && <span className="rounded bg-amber-500/10 px-2 py-0.5">{r.submissions} submissions · possible duplicate</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link scroll={false} href={transactionHref(r)} className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">{r.kind === "expense" ? "Manage expense / payment" : "Manage payment"}</Link>
                  {r.kind === "expense" && <Link scroll={false} href={workspaceHref("review-expenses", r.recordIds[0])} className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">Review & assign</Link>}
                </div>
                <details className="mt-2 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer py-1">Transaction details</summary>
                  <div className="mt-1 space-y-1 break-words">
                    {r.description && <p>{r.description}</p>}
                    {r.reference && <p>Reference: {r.reference}</p>}
                    {r.method && <p>Method: {r.method.replaceAll("_", " ")}</p>}
                    <p>Source: {r.source.replaceAll("_", " ")}</p>
                    {r.allocations > 1 && <p>{r.allocations} allocations · full bill shown once</p>}
                    {r.projects.length > 1 && <p>Shared across jobs; the full bill amount is shown.</p>}
                    <Link scroll={false} className="inline-block py-1 text-amber-600 dark:text-amber-400 hover:underline" href={transactionHref(r)}>{r.kind === "expense" ? "Manage bill & attachment →" : "Manage income payment →"}</Link>
                  </div>
                </details>
              </div>
            </div>
          </article>)}</div>
        </section>;
      })}
    </>}
  </>;
}
