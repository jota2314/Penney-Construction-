"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, ChevronRight, Receipt, Search, X } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { OpenBill, OpenBillsSummary } from "@/lib/finance/open-bills";

type View = "all" | "late" | "waiting" | "approved";
type SortKey = "due" | "amount" | "vendor";

const money = (value: number) => formatMoney(value, { cents: "always" });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const total = (bills: OpenBill[]) => bills.reduce((sum, bill) => sum + Math.round(bill.amount * 100), 0) / 100;
const isLate = (bill: OpenBill) => (bill.overdueDays ?? 0) > 0;
// Fixed time zone so the server render and the browser print the same date.
const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// "$3,480" and "3480" both find a $3,480.00 bill; "#2051" finds invoice 2051.
const normalize = (text: string) => text.toLowerCase().replace(/[$,]/g, "");
const searchText = (bill: OpenBill) =>
  normalize([bill.vendor, ...bill.projects, bill.reference ?? "", bill.reference ? `#${bill.reference}` : "", bill.amount.toFixed(2), ...bill.reasons].join(" "));
const matches = (bill: OpenBill, terms: string[]) => {
  const text = searchText(bill);
  return terms.every(term => text.includes(term));
};

const byDue = (a: OpenBill, b: OpenBill) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.vendor.localeCompare(b.vendor);
const SORTS: Record<SortKey, (a: OpenBill, b: OpenBill) => number> = {
  due: byDue,
  amount: (a, b) => b.amount - a.amount || byDue(a, b),
  vendor: (a, b) => a.vendor.localeCompare(b.vendor) || byDue(a, b),
};

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function OpenBillsCard({ summary }: { summary: OpenBillsSummary }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [sort, setSort] = useState<SortKey>("due");

  const tiles = useMemo(() => [
    { key: "all" as const, label: "All open", bills: summary.bills, tone: "" },
    { key: "late" as const, label: "Past due", bills: summary.bills.filter(isLate), tone: "text-red-600 dark:text-red-400" },
    { key: "waiting" as const, label: "Awaiting approval", bills: summary.bills.filter(bill => !bill.approved), tone: "text-amber-700 dark:text-amber-400" },
    { key: "approved" as const, label: "Approved to pay", bills: summary.bills.filter(bill => bill.approved), tone: "text-emerald-600 dark:text-emerald-400" },
  ], [summary.bills]);

  const terms = useMemo(() => normalize(query).split(/\s+/).filter(Boolean), [query]);
  const inView = tiles.find(tile => tile.key === view)?.bills ?? summary.bills;
  const visible = useMemo(() => inView.filter(bill => matches(bill, terms)).sort(SORTS[sort]), [inView, terms, sort]);
  const reviewVisible = useMemo(() => summary.review.filter(bill => matches(bill, terms)), [summary.review, terms]);
  const filtered = terms.length > 0 || view !== "all";
  const clear = () => { setQuery(""); setView("all"); };

  return <section id="open-bills" className="min-w-0 overflow-hidden rounded-xl border bg-card">
    <div className="flex items-center gap-2.5 border-b px-4 py-3">
      <Receipt className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <h3 className="text-sm font-semibold">Recorded open vendor bills</h3>
    </div>

    {/* Summary tiles double as filters. They always describe every open bill; search narrows only the list. */}
    <div className="grid grid-cols-2 gap-px border-b bg-border md:grid-cols-4">
      {tiles.map(tile => {
        const active = view === tile.key;
        const amount = total(tile.bills);
        return <button key={tile.key} type="button" aria-pressed={active}
          onClick={() => setView(active ? "all" : tile.key)}
          className={`min-w-0 px-4 py-3 text-left transition-colors ${focusRing} ${active ? "bg-muted/60 shadow-[inset_0_-2px_0_0_#d97706]" : "bg-card hover:bg-muted/30"}`}>
          <p className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{tile.label}</p>
          <p className={`mt-1 truncate text-lg font-semibold tabular-nums tracking-tight ${amount > 0 ? tile.tone : "text-muted-foreground"}`}>{money(amount)}</p>
          <p className="text-xs text-muted-foreground">{plural(tile.bills.length, "bill")}</p>
        </button>;
      })}
    </div>

    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
      <label className="relative min-w-48 flex-1">
        <span className="sr-only">Search bills</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape") setQuery(""); }}
          inputMode="search" enterKeyHint="search" autoComplete="off"
          placeholder="Search vendor, job or invoice #"
          className="h-10 w-full rounded-lg border bg-background pl-9 pr-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"
          className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>}
      </label>
      <label className="flex items-center gap-2 text-sm md:hidden">
        <span className="text-muted-foreground">Sort</span>
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="h-10 rounded-lg border bg-background px-2 text-sm">
          <option value="due">Due date</option>
          <option value="amount">Amount</option>
          <option value="vendor">Vendor</option>
        </select>
      </label>
      {filtered && <p className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
        {visible.length} of {plural(summary.bills.length, "bill")} · <span className="font-semibold text-foreground">{money(total(visible))}</span>
      </p>}
    </div>

    {visible.length > 0 && <div className="hidden grid-cols-[minmax(0,1fr)_9rem_9.5rem_8rem_1rem] gap-x-4 border-b bg-muted/20 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground md:grid">
      <SortButton label="Vendor & job" sortKey="vendor" sort={sort} setSort={setSort} />
      <SortButton label="Due" sortKey="due" sort={sort} setSort={setSort} />
      <span>Status</span>
      <SortButton label="Amount" sortKey="amount" sort={sort} setSort={setSort} className="justify-end" />
      <span />
    </div>}

    <div className="divide-y">
      {visible.map(bill => <BillRow key={bill.id} bill={bill} />)}
    </div>

    {!visible.length && <div className="px-4 py-8 text-center text-sm text-muted-foreground">
      {!summary.bills.length
        ? <p>No reviewed open vendor bills. Check the unresolved records below before concluding nothing is owed.</p>
        : <>
          <p>{terms.length ? <>No open bills match &ldquo;{query.trim()}&rdquo;{view !== "all" && " in this filter"}.</> : "No bills in this filter."}</p>
          {terms.length > 0 && reviewVisible.length > 0 && <p className="mt-1 text-xs">{plural(reviewVisible.length, "matching record")} {reviewVisible.length === 1 ? "is" : "are"} in the reconciliation list below.</p>}
          <button type="button" onClick={clear} className="mt-3 rounded-lg border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">Show all bills</button>
        </>}
    </div>}

    <p className="border-t px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
      Recorded balances on reviewed Penney records, not a bank-verified payable total. Split allocations count as one bill.
    </p>

    {summary.review.length > 0 && <details className="group border-t bg-amber-500/5">
      <summary className={`flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden ${focusRing}`}>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span>{plural(summary.review.length, "record")} {summary.review.length === 1 ? "needs" : "need"} reconciliation</span>
        {terms.length > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">{reviewVisible.length} match</span>}
        <span className="ml-auto text-xs font-normal text-muted-foreground">Not counted above</span>
      </summary>
      <p className="border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        {money(summary.reviewBalance)} in unresolved positive balances, plus any zero-balance status conflicts. These may be duplicate entries, internal labor, incoming checks or conflicting payment information. They are not confirmed amounts to pay.
      </p>
      <div className="divide-y border-t">
        {reviewVisible.map(bill => <Link key={bill.id} href={`/spent/${bill.id}`} className={`block px-4 py-3 text-xs hover:bg-muted/40 ${focusRing}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{bill.vendor}</span>
            <span className="font-medium tabular-nums">{bill.amount > 0 ? `${money(bill.amount)} unresolved` : "Balance/status conflict"}</span>
          </div>
          <p className="mt-0.5 text-muted-foreground">{bill.projects.join(" · ")}{bill.reference ? ` · #${bill.reference}` : ""}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bill.reasons.map(reason => <span key={reason} className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">{reason}</span>)}
          </div>
          <span className="mt-2 inline-flex items-center gap-1 text-muted-foreground underline underline-offset-2">Inspect record <ArrowUpRight className="h-3 w-3" /></span>
        </Link>)}
        {!reviewVisible.length && <p className="px-4 py-4 text-xs text-muted-foreground">No records here match your search.</p>}
      </div>
    </details>}
  </section>;
}

function SortButton({ label, sortKey, sort, setSort, className = "" }: {
  label: string; sortKey: SortKey; sort: SortKey; setSort: (key: SortKey) => void; className?: string;
}) {
  const active = sort === sortKey;
  return <button type="button" onClick={() => setSort(sortKey)} aria-pressed={active}
    className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground ${active ? "text-foreground" : ""} ${className}`}>
    {label}<ChevronDown className={`h-3 w-3 ${active ? "" : "opacity-0"}`} />
  </button>;
}

function BillRow({ bill }: { bill: OpenBill }) {
  const late = isLate(bill);
  return <Link href={`/spent/${bill.id}`}
    className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1fr)_9rem_9.5rem_8rem_1rem] ${focusRing}`}>
    <div className="col-start-1 row-start-1 min-w-0">
      <p className="text-sm font-medium md:truncate">{bill.vendor}</p>
      <p className="text-xs text-muted-foreground md:truncate" title={bill.projects.join(" · ")}>
        {bill.projects.join(" · ")}{bill.reference ? ` · #${bill.reference}` : ""}
      </p>
    </div>
    <span className="col-start-2 row-start-1 text-right text-sm font-semibold tabular-nums md:col-start-4">{money(bill.amount)}</span>
    {/* Phones: due + status share one line under the vendor. Desktop: each takes its own column. */}
    <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs md:col-start-2 md:row-start-1 md:block">
        <p className={late ? "font-medium text-red-600 dark:text-red-400" : bill.dueDate ? "" : "text-muted-foreground"}>
          {bill.dueDate ? <><span className="md:hidden">Due </span>{shortDate(bill.dueDate)}</> : "No due date"}
        </p>
        {late && <p className="text-[11px] text-red-600 dark:text-red-400">{plural(bill.overdueDays ?? 0, "day")} past due</p>}
      </div>
      <div className="md:col-start-3 md:row-start-1"><StatusPill approved={bill.approved} /></div>
    </div>
    <ChevronRight className="hidden h-4 w-4 text-muted-foreground md:col-start-5 md:row-start-1 md:block" />
  </Link>;
}

function StatusPill({ approved }: { approved: boolean }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${approved
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${approved ? "bg-emerald-500" : "bg-amber-500"}`} />
    {approved ? "Approved" : "Awaiting approval"}
  </span>;
}
