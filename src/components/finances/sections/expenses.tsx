import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from "lucide-react";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { financialRows } from "@/lib/crew/load-labor-ledger";
import { computePeriod, type TimeRange } from "@/lib/time-range";
import { countCapturesForReview } from "@/lib/actions/field-capture";
import { SPEND_CATEGORIES, type SpendCategory } from "@/lib/finance/spend-category";
import { buildExpenseView, expenseCents, expenseSummary, type ExpenseRecord, type ExpenseGroup } from "@/lib/finance/expense-model";
import { formatMoney } from "@/lib/money";
import { loadBankPeriod } from "@/lib/finance/load-bank-period";
import { BankPeriodPanel, BankPeriodUnavailable } from "@/components/finances/bank-period-panel";

const fmt = (cents: number | null) => cents === null ? "Needs review" : formatMoney(cents / 100);
const shortMoney = (cents: number) => {
  const amount = Math.abs(cents / 100);
  return `${cents < 0 ? "−" : ""}${amount >= 1000 ? `${Math.round(amount / 1000)}k` : Math.round(amount)}`;
};
const RANGES: { label: string; value: TimeRange }[] = [
  { label: "Week", value: "week" }, { label: "Month", value: "month" },
  { label: "Quarter", value: "quarter" }, { label: "Year", value: "year" },
];
const parseDate = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
};
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const shortDate = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const mondayOf = (date: Date) => {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
};
type Bucket = { key: string; label: string; tick: string; href?: string };

function CategoryChip({ category }: { category: SpendCategory }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${category.chip}`}>{category.label}</span>;
}

function ExpenseRow({ group }: { group: ExpenseGroup }) {
  const isCredit = group.amountCents !== null && group.amountCents < 0;
  const hasPaymentIssue = group.allocations.some(a => a.paymentIssue);
  const status = isCredit ? "Credit" : hasPaymentIssue || group.openCents === null ? "Payment review" : group.openCents === 0 ? "Recorded paid" : (group.paidCents ?? 0) > 0 ? "Part paid" : "Open";
  const detail = <>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="break-words text-sm font-semibold">{group.vendor}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isCredit ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : group.openCents === 0 && !hasPaymentIssue ? "bg-muted text-muted-foreground" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>{status}</span>
      </div>
      <p className="mt-1 break-words text-xs text-muted-foreground">
        {group.projects.length > 1 ? `${group.projects.length} jobs · ${group.projects.join(" / ")}` : group.projects[0]}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{group.date ? shortDate(parseDate(group.date)) : "No bill date"}</span>
        {group.reference && <span className="break-all">· #{group.reference}</span>}
        {group.allocations.some(a => a.record.split_group_id) && <span>· Split · {group.allocations.length} allocation{group.allocations.length === 1 ? "" : "s"} in view</span>}
        {group.filteredSplit && <span>· Selected allocations</span>}
        {group.categories.map(category => <CategoryChip key={category.key} category={category} />)}
      </div>
      {group.reasons.length > 0 && <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">Needs review · {group.reasons.join("; ")}</p>}
    </div>
    <div className="max-w-[45%] shrink-0 text-right tabular-nums">
      <p className={`break-words text-sm font-semibold ${isCredit ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{fmt(group.amountCents)}</p>
      {!isCredit && group.openCents !== null && group.openCents > 0 && <p className="mt-1 text-[11px] text-muted-foreground">{fmt(group.openCents)} open</p>}
      {!isCredit && (group.paidCents ?? 0) > 0 && (group.openCents ?? 0) > 0 && <p className="text-[11px] text-muted-foreground">{fmt(group.paidCents)} paid</p>}
    </div>
  </>;
  if (group.allocations.length === 1) return <Link href={`/spent/${group.id}`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40">{detail}</Link>;
  return <details className="group">
    <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-muted/40">{detail}<ChevronRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" /></summary>
    <div className="border-t bg-muted/20 px-4 py-2">
      <p className="mb-1 text-[11px] text-muted-foreground">Open an allocation to inspect its bill and budget line.</p>
      {group.allocations.map(allocation => <Link key={allocation.record.id} href={`/spent/${allocation.record.id}`} className="flex items-start justify-between gap-3 rounded-md px-2 py-2 text-xs hover:bg-muted/60">
        <span className="min-w-0 break-words">{allocation.projectLabel}<span className="block text-muted-foreground">{allocation.category.label}{!allocation.record.estimate_line_item_id ? " · No budget line" : ""}</span></span>
        <span className="shrink-0 font-medium tabular-nums">{fmt(allocation.amountCents)} ↗</span>
      </Link>)}
    </div>
  </details>;
}

export default async function Expenses({ searchParams }: {
  searchParams?: Promise<{ range?: string; offset?: string; cat?: string; unallocated?: string }>;
}) {
  await requireAuth();
  const params = (await searchParams) || {};
  const range: TimeRange = RANGES.some(r => r.value === params.range) ? params.range as TimeRange : "year";
  const rawOffset = Number(params.offset || 0);
  const offset = Number.isInteger(rawOffset) && Math.abs(rawOffset) <= 100 ? rawOffset : 0;
  const catFilter = params.cat ? SPEND_CATEGORIES[params.cat] ?? null : null;
  const unallocatedOnly = params.unallocated === "1";
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const period = computePeriod(range, offset, nowET);
  const start = isoDay(new Date(period.start)), end = isoDay(new Date(period.end));
  const supabase = await createClient();
  // Bill date defines this view. Card purchases stay here; bank repayments and
  // payroll bank debits are never appended to bill rows. Include undated records
  // only to make missing coverage visible, not to assign them to this period.
  const [records, needsReview, bankPeriod] = await Promise.all([
    financialRows((from, to) => supabase.from("invoices")
      .select("id, vendor_name, vendor_type, trade, description, invoice_number, amount, paid_amount, invoice_date, payment_status, payment_method, project_id, split_group_id, estimate_line_item_id, source, review_status, is_capex, projects(name, project_number, is_overhead), estimate_line_items(description)")
      .is("duplicate_of_id", null)
      .or(`and(invoice_date.gte.${start},invoice_date.lte.${end}),invoice_date.is.null`)
      .order("invoice_date", { ascending: false, nullsFirst: false }).order("id").range(from, to)),
    countCapturesForReview().catch(() => null),
    loadBankPeriod({ start, end }).catch(() => null),
  ]);
  const view = buildExpenseView(records as ExpenseRecord[], { start, end, category: catFilter?.key, unallocatedOnly });
  const summary = view.summary;
  const moneyComplete = summary.invalidAmountCount === 0;
  const paymentComplete = summary.unresolvedPaymentCount === 0;
  const paymentReviewNote = `${summary.unresolvedPaymentCount} allocations excluded pending payment review`;
  const catQs = catFilter ? `&cat=${encodeURIComponent(catFilter.key)}` : "";
  const allocQs = unallocatedOnly ? "&unallocated=1" : "";
  const periodHref = (targetRange: TimeRange, targetOffset: number) => `/finances?section=expenses&range=${targetRange}&offset=${targetOffset}${catQs}${allocQs}`;
  const clearHref = `/finances?section=expenses&range=${range}&offset=${offset}`;
  const cashHref = range === "month" && start.slice(0, 4) === String(nowET.getFullYear())
    ? `/finances?section=cash&m=${start.slice(0, 7)}` : undefined;
  const mode = range === "week" ? "day" : range === "month" ? "week" : "month";
  const buckets: Bucket[] = [];
  const startDate = parseDate(start), endDate = parseDate(end);
  if (mode === "month") {
    for (let date = new Date(startDate.getFullYear(), startDate.getMonth(), 1); date <= endDate; date = new Date(date.getFullYear(), date.getMonth() + 1, 1)) {
      const monthOffset = (date.getFullYear() - nowET.getFullYear()) * 12 + date.getMonth() - nowET.getMonth();
      buckets.push({ key: isoDay(date).slice(0, 7), label: date.toLocaleDateString("en-US", { month: "long", year: "numeric" }), tick: date.toLocaleDateString("en-US", { month: "short" }), href: periodHref("month", monthOffset) });
    }
  } else if (mode === "week") {
    for (let date = mondayOf(startDate); date <= endDate; date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7)) {
      const weekOffset = Math.round((date.getTime() - mondayOf(nowET).getTime()) / (7 * 86400000));
      buckets.push({ key: isoDay(date), label: `Week of ${shortDate(date)}`, tick: shortDate(date), href: periodHref("week", weekOffset) });
    }
  } else {
    for (let date = new Date(startDate); date <= endDate; date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
      buckets.push({ key: isoDay(date), label: date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }), tick: date.toLocaleDateString("en-US", { weekday: "short" }) });
    }
  }
  const bucketKey = (date: string) => mode === "month" ? date.slice(0, 7) : mode === "week" ? isoDay(mondayOf(parseDate(date))) : date;
  const bucketTotals = new Map(buckets.map(bucket => [bucket.key, expenseSummary(view.allocations.filter(a => bucketKey(a.record.invoice_date!) === bucket.key))]));
  const maxBucket = Math.max(1, ...[...bucketTotals.values()].map(total => Math.abs(total.netCents)));
  const categories = [...new Map(view.allocations.map(a => [a.category.key, a.category])).values()].map(category => ({ category, summary: expenseSummary(view.allocations.filter(a => a.category.key === category.key)) })).sort((a, b) => Math.abs(b.summary.netCents) - Math.abs(a.summary.netCents));
  const maxCategory = Math.max(1, ...categories.map(c => Math.abs(c.summary.netCents)));
  const grouped = [...buckets].reverse().map(bucket => ({ bucket, groups: view.groups.filter(group => bucketKey(group.date!) === bucket.key), summary: bucketTotals.get(bucket.key)! })).filter(g => g.groups.length);
  const rowCap = mode === "month" ? 25 : Number.POSITIVE_INFINITY;

  return <div className="space-y-4">
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-medium text-muted-foreground">Bill-date view</p><p className="mt-1 text-lg font-semibold">{period.label}</p></div>
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
          {RANGES.map(item => <Link key={item.value} href={periodHref(item.value, 0)} aria-current={range === item.value ? "page" : undefined} className={`rounded-md px-3 py-1.5 text-xs ${range === item.value ? "bg-background font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{item.label}</Link>)}
          <Link href={periodHref(range, offset - 1)} aria-label="Previous period" className="rounded-md p-1.5 hover:bg-background"><ChevronLeft className="h-4 w-4" /></Link>
          <Link href={periodHref(range, offset + 1)} aria-label="Next period" className="rounded-md p-1.5 hover:bg-background"><ChevronRight className="h-4 w-4" /></Link>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Bills and receipts dated {shortDate(startDate)}–{shortDate(endDate)}, including card purchases and unpaid costs. Credits reduce the recorded cost. Payment amounts describe these bills, regardless of when paid. <a href="#bank-period" className="font-medium underline underline-offset-2">Compare bank money movements for this period.</a></p>
      {(catFilter || unallocatedOnly) && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Bill totals filtered by:</span>
        {catFilter && <Link href={`${clearHref}${allocQs}`} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${catFilter.chip}`}>{catFilter.label}<X className="h-3 w-3" /></Link>}
        {unallocatedOnly && <Link href={`${clearHref}${catQs}`} className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-400">Missing job / budget line<X className="h-3 w-3" /></Link>}
      </div>}
    </div>

    <div id="bank-period" className="scroll-mt-28">
      {bankPeriod ? <BankPeriodPanel bank={bankPeriod} periodLabel={period.label} cashHref={cashHref} /> : <BankPeriodUnavailable />}
    </div>

    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {[
        { label: "Net recorded expenses", value: moneyComplete ? summary.netCents : null, note: `${summary.billCount.toLocaleString()} bills / receipts · ${summary.recordCount.toLocaleString()} allocations` },
        { label: "Credits & returns", value: moneyComplete ? summary.creditsCents : null, note: "Already deducted from net expenses" },
        { label: paymentComplete ? "Recorded paid" : "Known recorded paid", value: paymentComplete ? summary.paidCents : summary.knownPaymentCount > 0 ? summary.knownPaidCents : null, note: paymentComplete ? "Includes part payments · not bank-cleared cash" : paymentReviewNote },
        { label: paymentComplete ? "Recorded open balance" : "Known open balance", value: paymentComplete ? summary.openCents : summary.knownPaymentCount > 0 ? summary.knownOpenCents : null, note: paymentComplete ? "These bills only · review before paying" : paymentReviewNote },
      ].map(card => <div key={card.label} className="@container min-w-0 rounded-xl border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">{card.label}</p><p className="mt-2 text-[clamp(0.875rem,12cqi,1.75rem)] font-semibold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere]">{fmt(card.value)}</p><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{card.note}</p>
      </div>)}
    </div>

    <div className="flex justify-end"><Link href="/finances?section=bills" className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2">Review payable bills<ArrowUpRight className="h-3 w-3" /></Link></div>

    <div className="rounded-xl border bg-card px-4 py-3 text-xs">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <span>Charges <strong className="tabular-nums">{fmt(moneyComplete ? summary.chargesCents : null)}</strong></span>
        <span>On jobs <strong className="tabular-nums">{fmt(moneyComplete ? summary.projectCents : null)}</strong></span>
        <span>On overhead job <strong className="tabular-nums">{fmt(moneyComplete ? summary.overheadCents : null)}</strong></span>
        <span>Unassigned <strong className="tabular-nums">{fmt(moneyComplete ? summary.unassignedCents : null)}</strong></span>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Recorded purchases, not a final profit statement. Payroll includes recorded bills only; modeled crew wages are not added.{summary.capitalCents !== 0 ? ` Includes ${fmt(summary.capitalCents)} flagged capital purchases.` : ""} <Link href="/finances?section=overhead" className="underline underline-offset-2">Open the overhead report for operating costs and payroll allocation.</Link></p>
    </div>

    {(summary.reviewCount > 0 || view.undatedCount > 0 || needsReview === null || (needsReview ?? 0) > 0) && <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs">
      <p className="font-semibold">What needs checking</p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground">
        {summary.reviewCount > 0 && <span>{summary.reviewCount} allocations in this view need review.</span>}
        {summary.missingAllocationCount > 0 && <Link className="underline underline-offset-2" href={`${clearHref}${catQs}&unallocated=1`}>{summary.missingAllocationCount} missing a job or budget line.</Link>}
        {summary.qbImportedCount > 0 && <span>{summary.qbImportedCount} QuickBooks imports need Penney source verification.</span>}
        {summary.invalidAmountCount > 0 && <span>{summary.invalidAmountCount} bill amounts are missing or invalid; totals are incomplete.</span>}
        {summary.unresolvedPaymentCount > 0 && <span>Paid/open cards show only coherent recorded amounts; {summary.unresolvedPaymentCount} allocations with missing or conflicting payment data are excluded.</span>}
        {view.undatedCount > 0 && <span>{view.undatedCount} undated bills across all periods are excluded from period totals.</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <Link href="/spent/review" className="inline-flex items-center gap-1 font-medium underline underline-offset-2">{needsReview === null ? "Open receipt review — count unavailable" : `Review receipts${needsReview ? ` (${needsReview} across all periods)` : ""}`}<ArrowUpRight className="h-3 w-3" /></Link>
      </div>
      {view.undatedCount > 0 && <details className="mt-3 border-t border-amber-500/20 pt-3"><summary className="cursor-pointer font-medium">Inspect {view.undatedCount} undated bills</summary><div className="mt-2 divide-y divide-amber-500/10">{view.undatedRecords.map(record => <Link key={record.id} href={`/spent/${record.id}`} className="flex justify-between gap-3 py-2 hover:underline"><span>{record.vendor_name || "Unknown vendor"}{record.invoice_number ? ` · #${record.invoice_number}` : ""}</span><span className="shrink-0 tabular-nums">{fmt(expenseCents(record.amount))} ↗</span></Link>)}</div></details>}
    </div>}

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="min-w-0 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Net expenses by {mode}</h2><p className="mt-1 text-[11px] text-muted-foreground">Bill date · credits shown in green</p>
        <div className="mt-5 flex h-32 items-end gap-1">
          {buckets.map(bucket => {
            const total = bucketTotals.get(bucket.key)!;
            const value = total.netCents;
            const contents = <><span className="text-[9px] tabular-nums text-muted-foreground">{total.invalidAmountCount ? "?" : value ? shortMoney(value) : "—"}</span><div className={`w-full max-w-8 rounded-t ${value < 0 ? "bg-emerald-500/70" : value > 0 ? "bg-amber-500/75" : "bg-muted"}`} style={{ height: `${total.invalidAmountCount ? 2 : Math.max(2, Math.abs(value) / maxBucket * 80)}px` }} /><span className="text-[9px] text-muted-foreground">{bucket.tick}</span></>;
            const className = "flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5 hover:opacity-80";
            return bucket.href ? <Link key={bucket.key} href={bucket.href} className={className} title={`${bucket.label}: ${fmt(total.invalidAmountCount ? null : value)}`}>{contents}</Link> : <div key={bucket.key} className={className} title={`${bucket.label}: ${fmt(total.invalidAmountCount ? null : value)}`}>{contents}</div>;
          })}
        </div>
      </section>
      <section className="min-w-0 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Expense categories</h2>{catFilter && <Link href={`${clearHref}${allocQs}`} className="text-xs underline underline-offset-2">Show all</Link>}</div>
        <p className="mt-1 text-[11px] text-muted-foreground">Select a category to filter the whole view</p>
        <div className="mt-3 space-y-2">
          {!categories.length && <p className="py-3 text-sm text-muted-foreground">No recorded expenses match this view.</p>}
          {categories.map(({ category, summary: categorySummary }) => <Link key={category.key} href={`${clearHref}${allocQs}${catFilter?.key === category.key ? "" : `&cat=${category.key}`}`} className="block rounded-md p-1.5 hover:bg-muted/40">
            <div className="flex items-start justify-between gap-3 text-xs"><span className="flex min-w-0 items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${category.dot}`} />{category.label}</span><span className="shrink-0 font-medium tabular-nums">{fmt(categorySummary.invalidAmountCount ? null : categorySummary.netCents)}</span></div>
            <div className="mt-1.5 h-1 rounded-full bg-muted"><div className={`h-1 rounded-full ${category.dot}`} style={{ width: `${categorySummary.invalidAmountCount ? 0 : Math.abs(categorySummary.netCents) / maxCategory * 100}%` }} /></div>
          </Link>)}
        </div>
      </section>
    </div>

    <section id="transactions" className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Bills, receipts &amp; credits</h2><p className="mt-1 text-xs text-muted-foreground">{summary.billCount.toLocaleString()} bills / receipts in this view. Open a row for its source; expand split bills for every allocation.</p></div>
      {!grouped.length && <p className="p-8 text-center text-sm text-muted-foreground">No records match this period and filters.</p>}
      {grouped.map(({ bucket, groups, summary: bucketSummary }) => <div key={bucket.key}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-muted/50 px-4 py-2"><span className="text-xs font-semibold">{bucket.label}</span><span className="text-xs tabular-nums">{fmt(bucketSummary.invalidAmountCount ? null : bucketSummary.netCents)} <span className="text-muted-foreground">net</span></span></div>
        <div className="divide-y">{groups.slice(0, rowCap).map(group => <ExpenseRow key={group.key} group={group} />)}</div>
        {groups.length > rowCap && bucket.href && <Link href={bucket.href} className="block border-t px-4 py-3 text-xs font-medium text-amber-700 hover:bg-muted/40 dark:text-amber-400">Open {bucket.label} for {groups.length - rowCap} more entries →</Link>}
      </div>)}
    </section>
    <p className="text-[11px] text-muted-foreground">Explicit duplicates and {view.excludedInternalCount.toLocaleString()} internal labor allocations are excluded. Card repayments are shown in Cash flow. Unapplied vendor credits reduce recorded cost but do not automatically settle another bill.</p>
  </div>;
}
