import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ArrowUpRight, X } from "lucide-react";
import { computePeriod, type TimeRange } from "@/lib/time-range";
import { countCapturesForReview } from "@/lib/actions/field-capture";
import { SPEND_CATEGORIES, spendCategoryFor, type SpendCategory } from "@/lib/finance/spend-category";
import { FinanceTabs } from "@/components/finances/finance-tabs";

export const metadata: Metadata = { title: "Finances — Expenses | Penney Construction" };

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

// Compact money for bar labels: 121450 → "121k", 890 → "890".
const kfmt = (n: number): string => (n >= 999.5 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);

const VALID_RANGES: ReadonlyArray<TimeRange> = ["week", "month", "quarter", "year"];

// invoice_date is a plain DATE ("YYYY-MM-DD") — parse in the local frame so
// the day never shifts across the UTC boundary.
const parseDate = (s: string): Date => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const mondayOf = (d: Date): Date => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const shortDate = (d: Date): string => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

type BucketMode = "month" | "week" | "day";

interface Bucket {
  key: string;
  /** Group header in the transaction list ("August", "Week of Aug 3 – 9", "Tuesday, Aug 18"). */
  label: string;
  /** Tick under the chart bar ("A", "Aug 3", "Tue"). */
  tick: string;
  /** Drill-down target for the bar, when one exists. */
  href?: string;
  start: Date;
  isCurrent: boolean;
}

interface InvoiceRow {
  id: string;
  vendor_name: string | null;
  vendor_type: string | null;
  trade: string | null;
  description: string | null;
  invoice_number: string | null;
  amount: number | null;
  paid_amount: number | null;
  invoice_date: string | null;
  payment_status: string | null;
  payment_method: string | null;
  project_id: string | null;
  split_group_id: string | null;
  /** Null = the bill never got pinned to a budget line, so job margin can't see it. */
  estimate_line_item_id: string | null;
  /** Set on merged rows: how many split pieces this row stands for. */
  split_count?: number;
  projects:
    | { name: string | null; project_number: string | null; is_overhead: boolean | null }
    | { name: string | null; project_number: string | null; is_overhead: boolean | null }[]
    | null;
}

export default async function SpentPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string; offset?: string; cat?: string; unallocated?: string }>;
}) {
  await requireAuth();
  const params = (await searchParams) || {};
  const range: TimeRange = (VALID_RANGES as ReadonlyArray<string>).includes(params.range || "")
    ? (params.range as TimeRange)
    : "year"; // default to full year when no range given
  const offset = Number.parseInt(params.offset || "0", 10) || 0;
  const catFilter: SpendCategory | null = (params.cat && SPEND_CATEGORIES[params.cat]) || null;
  // Arrives from the weekly-close card ("N invoices on no budget line"). Same
  // test as /week: no estimate_line_item_id and not an overhead bill.
  const unallocatedOnly = params.unallocated === "1";

  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const period = computePeriod(range, offset, nowET);
  const periodStartDate = period.start.slice(0, 10);
  const periodEndDate = period.end.slice(0, 10);

  const supabase = await createClient();

  // EVERYTHING shows here — paid receipts, unpaid bills, on-account tickets.
  // Jorge 8/19: "the bill, the gas, the receipts — everything needs to be
  // here in spending." Paid rows make the Spent total; unpaid rows make the
  // Owed total and wear a chip in the list.
  //
  // Fetched in 1000-row pages: PostgREST caps a single select at 1000 and the
  // year already holds ~1,450 bills — a .limit(500) here was silently halving
  // the year's totals. The id tiebreak keeps pages stable when many rows share
  // one invoice_date.
  const rows: InvoiceRow[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 10 * PAGE; from += PAGE) {
    const { data } = await supabase
      .from("invoices")
      .select("id, vendor_name, vendor_type, trade, description, invoice_number, amount, paid_amount, invoice_date, payment_status, payment_method, project_id, split_group_id, estimate_line_item_id, projects(name, project_number, is_overhead)")
      .gte("invoice_date", periodStartDate)
      .lte("invoice_date", periodEndDate)
      .order("invoice_date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    const batch = (data ?? []) as InvoiceRow[];
    // Cash basis (Jorge 8/23/26): this page shows money that LEFT EASTERN in
    // the period, so two kinds of rows sit out. 'capital_one' = Capital One
    // card charges — real job costs (project pages still count them) but cash
    // leaves only at settlement, shown below as the card-payoff bank lines.
    // 'internal' = In-House Labor placeholders — wages actually leave via the
    // ADP payroll rows, which ARE in this list.
    rows.push(...batch.filter(r => r.payment_method !== "capital_one" && r.payment_method !== "internal"));
    if (batch.length < PAGE) break;
  }

  // A bill split across budget lines is stored as one invoice row per line
  // (split_vendor_invoice), all sharing a split_group_id. It was ONE check to
  // ONE vendor — collapse the pieces back into a single transaction here.
  // Amounts sum, so every total/chart below is unchanged.
  // Kept un-collapsed for the unallocated view: allocation is done one budget
  // line at a time, so each split piece has to stay its own row there.
  const preSplitRows = [...rows];
  {
    const byGroup = new Map<string, InvoiceRow>();
    const collapsed: InvoiceRow[] = [];
    for (const r of rows) {
      if (!r.split_group_id) {
        collapsed.push(r);
        continue;
      }
      const head = byGroup.get(r.split_group_id);
      if (!head) {
        const copy: InvoiceRow = { ...r, split_count: 1 };
        byGroup.set(r.split_group_id, copy);
        collapsed.push(copy);
      } else {
        head.amount = Number(head.amount || 0) + Number(r.amount || 0);
        head.paid_amount = Number(head.paid_amount || 0) + Number(r.paid_amount || 0);
        head.split_count = (head.split_count || 1) + 1;
        // Pieces normally share a status; if they ever diverge, show partial.
        if (head.payment_status !== r.payment_status) head.payment_status = "partial";
      }
    }
    rows.length = 0;
    rows.push(...collapsed);
  }

  // The card payoffs themselves — Capital One / Amex payments out of Eastern,
  // straight from the reconciled statement lines. Rendered as synthetic rows
  // (id "bank:<uuid>") so month totals equal the bank statement to the penny.
  const { data: payoffLines } = await supabase
    .from("bank_transactions")
    .select("id, txn_date, description, amount")
    .eq("category_key", "card_payoff")
    .eq("direction", "debit")
    .gte("txn_date", periodStartDate)
    .lte("txn_date", periodEndDate);
  for (const p of payoffLines ?? []) {
    rows.push({
      id: `bank:${p.id}`,
      vendor_name: /amex/i.test(p.description ?? "") ? "Amex" : "Capital One",
      vendor_type: null,
      trade: null,
      description: p.description,
      invoice_number: null,
      amount: Number(p.amount),
      paid_amount: Number(p.amount),
      invoice_date: p.txn_date,
      payment_status: "paid",
      payment_method: "ach",
      project_id: null,
      split_group_id: null,
      estimate_line_item_id: null,
      projects: null,
    });
  }
  rows.sort((a, b) => (b.invoice_date ?? "").localeCompare(a.invoice_date ?? "") || b.id.localeCompare(a.id));

  // Field captures the AI flagged. They are already inside the totals below,
  // so the banner is a correction prompt, not a "pending" bucket.
  const needsReview = await countCapturesForReview();

  const projOf = (r: InvoiceRow) => (Array.isArray(r.projects) ? r.projects[0] : r.projects) ?? null;

  // Overhead = the Office — Overhead project (is_overhead) OR legacy rows
  // with no project at all. Filtering on !project_id alone reads $0 forever,
  // because overhead bills carry PC-2026-179 since July.
  const isOverheadRow = (r: InvoiceRow): boolean => !r.project_id || Boolean(projOf(r)?.is_overhead);

  // What the row is worth in this view: paid rows count what was paid, open
  // bills count what's owed.
  const effAmt = (r: InvoiceRow): number =>
    r.payment_status === "paid" ? Number(r.paid_amount || r.amount || 0) : Number(r.amount || 0);

  // Split pieces ride along after the collapsed rows so the unallocated list
  // can look up a category for a tail piece. First write wins, so a collapsed
  // head keeps its own entry.
  const categoryOf = new Map<string, SpendCategory>();
  for (const r of [...rows, ...preSplitRows]) {
    if (categoryOf.has(r.id)) continue;
    if (r.id.startsWith("bank:")) {
      categoryOf.set(r.id, SPEND_CATEGORIES.cardpay);
      continue;
    }
    categoryOf.set(
      r.id,
      spendCategoryFor({
        vendorName: r.vendor_name,
        vendorType: r.vendor_type,
        trade: r.trade,
        description: r.description,
        isOverhead: isOverheadRow(r),
      }),
    );
  }

  const paidRows = rows.filter(r => r.payment_status === "paid");
  const unpaidRows = rows.filter(r => r.payment_status !== "paid");
  const totalSpent = paidRows.reduce((s, r) => s + effAmt(r), 0);
  const owedTotal = unpaidRows.reduce((s, r) => s + (Number(r.amount || 0) - Number(r.paid_amount || 0)), 0);
  const overhead = paidRows.filter(isOverheadRow);
  const projectSpent = paidRows.filter(r => !isOverheadRow(r));
  const overheadTotal = overhead.reduce((s, r) => s + effAmt(r), 0);
  const projectTotal = projectSpent.reduce((s, r) => s + effAmt(r), 0);

  // ---- Time buckets: the chart and the list group on the same boundaries.
  // Year/quarter break into months, a month into weeks, a week into days.
  const bucketMode: BucketMode = range === "week" ? "day" : range === "month" ? "week" : "month";
  const bucketNoun = bucketMode === "month" ? "month" : bucketMode === "week" ? "week" : "day";

  const periodStart = parseDate(periodStartDate);
  const periodEnd = parseDate(periodEndDate);
  const today = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate());

  const buckets: Bucket[] = [];
  if (bucketMode === "month") {
    for (let d = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1); d <= periodEnd; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const monthName = d.toLocaleDateString("en-US", { month: "long" });
      const monthOffset = (d.getFullYear() - nowET.getFullYear()) * 12 + (d.getMonth() - nowET.getMonth());
      buckets.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: monthName,
        tick: range === "year" ? monthName[0] : d.toLocaleDateString("en-US", { month: "short" }),
        href: `/spent?range=month&offset=${monthOffset}`,
        start: d,
        isCurrent: d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth(),
      });
    }
  } else if (bucketMode === "week") {
    const thisMonday = mondayOf(today).getTime();
    for (let d = mondayOf(periodStart); d <= periodEnd; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)) {
      const weekEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6);
      const weekOffset = Math.round((d.getTime() - thisMonday) / (7 * 86400000));
      buckets.push({
        key: isoDay(d),
        label: `Week of ${shortDate(d)} – ${shortDate(weekEnd)}`,
        tick: shortDate(d),
        href: `/spent?range=week&offset=${weekOffset}`,
        start: d,
        isCurrent: thisMonday === d.getTime(),
      });
    }
  } else {
    for (let d = new Date(periodStart); d <= periodEnd; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      buckets.push({
        key: isoDay(d),
        label: d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
        tick: d.toLocaleDateString("en-US", { weekday: "short" }),
        start: d,
        isCurrent: d.getTime() === today.getTime(),
      });
    }
  }

  const bucketKeyFor = (dateStr: string): string =>
    bucketMode === "month" ? dateStr.slice(0, 7) : bucketMode === "week" ? isoDay(mondayOf(parseDate(dateStr))) : dateStr.slice(0, 10);

  // Chart: paid spend per bucket (matches the Total spent tile).
  const paidByBucket = new Map<string, number>();
  for (const r of paidRows) {
    if (!r.invoice_date) continue;
    const k = bucketKeyFor(r.invoice_date);
    paidByBucket.set(k, (paidByBucket.get(k) || 0) + effAmt(r));
  }
  const maxBucket = Math.max(0, ...buckets.map(b => paidByBucket.get(b.key) || 0));
  const elapsed = buckets.filter(b => b.start <= today);
  const avgPerBucket = elapsed.length > 0 ? totalSpent / elapsed.length : 0;

  // Where it went: paid spend per chart-of-accounts bucket, biggest first.
  const catTotals = new Map<string, { cat: SpendCategory; total: number; n: number }>();
  for (const r of paidRows) {
    const c = categoryOf.get(r.id)!;
    const entry = catTotals.get(c.key) || { cat: c, total: 0, n: 0 };
    entry.total += effAmt(r);
    entry.n += 1;
    catTotals.set(c.key, entry);
  }
  const catRows = [...catTotals.values()].sort((a, b) => b.total - a.total);
  const topCats = catRows.slice(0, 8);
  const restCats = catRows.slice(8);
  const restTotal = restCats.reduce((s, c) => s + c.total, 0);
  const maxCat = topCats[0]?.total || 0;

  // Transaction list: grouped newest-first on the same buckets as the chart.
  // Filters narrow ONLY this list — tiles and charts stay whole.
  const listBase = unallocatedOnly
    ? preSplitRows.filter(r => !r.estimate_line_item_id && !isOverheadRow(r))
    : rows;
  const listRows = catFilter ? listBase.filter(r => categoryOf.get(r.id)!.key === catFilter.key) : listBase;
  const rowsByBucket = new Map<string, InvoiceRow[]>();
  for (const r of listRows) {
    if (!r.invoice_date) continue;
    const k = bucketKeyFor(r.invoice_date);
    const arr = rowsByBucket.get(k);
    if (arr) arr.push(r);
    else rowsByBucket.set(k, [r]);
  }
  // Year/quarter cap each month at 25 rendered rows (the header still counts
  // and sums ALL of them) — a 1,400-row year page would crawl on a phone, and
  // the month bar/tail link is the same data one tap deeper. Month and week
  // views render everything.
  const ROW_CAP = bucketMode === "month" ? 25 : Number.POSITIVE_INFINITY;
  const listGroups = [...buckets]
    .reverse()
    .map(b => {
      const groupRows = rowsByBucket.get(b.key) || [];
      const paid = groupRows.filter(r => r.payment_status === "paid").reduce((s, r) => s + effAmt(r), 0);
      const open = groupRows
        .filter(r => r.payment_status !== "paid")
        .reduce((s, r) => s + (Number(r.amount || 0) - Number(r.paid_amount || 0)), 0);
      return { bucket: b, rows: groupRows.slice(0, ROW_CAP), hidden: Math.max(groupRows.length - ROW_CAP, 0), paid, open, count: groupRows.length };
    })
    .filter(g => g.count > 0);

  // Period switcher (plain links — simple, no client JS needed). An active
  // category filter rides along so switching periods keeps the filter.
  const catQs = catFilter ? `&cat=${catFilter.key}` : "";
  const allocQs = unallocatedOnly ? "&unallocated=1" : "";
  const RANGE_BUTTONS: { label: string; value: TimeRange }[] = [
    { label: "Week", value: "week" },
    { label: "Month", value: "month" },
    { label: "Quarter", value: "quarter" },
    { label: "Year", value: "year" },
  ];

  const CatChip = ({ cat }: { cat: SpendCategory }) => (
    <span
      title={`Books to: ${cat.qbAccount}`}
      className={`inline-flex shrink-0 items-center px-1.5 py-px rounded-full text-[9.5px] font-semibold uppercase tracking-wide ${cat.chip}`}
    >
      {cat.label}
    </span>
  );

  return (
    <>
      <Header title="Finances" backHref="/command-center" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        <FinanceTabs current="expenses" />
        {needsReview > 0 && (
          <Link
            href="/spent/review"
            className="flex items-center justify-between gap-3 rounded-xl border border-amber-600/40 bg-amber-600/10 px-4 py-3"
          >
            <div>
              <div className="text-sm font-semibold text-amber-600">
                {needsReview} cost{needsReview === 1 ? "" : "s"} to sort out
              </div>
              <div className="text-xs text-muted-foreground">
                Flagged receipts and bank lines with no job — group by vendor and assign in batches
              </div>
            </div>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-amber-600" />
          </Link>
        )}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Period</div>
            <div className="text-[15px] font-semibold">{period.label}</div>
          </div>
          <div className="flex bg-muted rounded-lg p-0.5 flex-wrap">
            {RANGE_BUTTONS.map(b => (
              <Link
                key={b.value}
                href={`/spent?range=${b.value}&offset=0${catQs}${allocQs}`}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  range === b.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {b.label}
              </Link>
            ))}
            <Link
              href={`/spent?range=${range}&offset=${offset - 1}${catQs}${allocQs}`}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground"
            >
              ←
            </Link>
            <Link
              href={`/spent?range=${range}&offset=${offset + 1}${catQs}${allocQs}`}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground"
            >
              →
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total spent</div>
            <div className="text-2xl font-bold tabular-nums mt-1">{fmt(totalSpent)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{paidRows.length.toLocaleString()} paid transactions</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">On projects</div>
            <div className="text-2xl font-bold tabular-nums mt-1 text-amber-500">{fmt(projectTotal)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{projectSpent.length.toLocaleString()} invoices</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Overhead</div>
            <div className="text-2xl font-bold tabular-nums mt-1 text-orange-500">{fmt(overheadTotal)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{overhead.length.toLocaleString()} invoices</div>
          </div>
          <Link href="/invoices?tab=unpaid" className="rounded-lg border bg-card p-4 hover:bg-muted/40 transition-colors">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Owed (unpaid)</div>
            <div className="text-2xl font-bold tabular-nums mt-1 text-red-400">{fmt(owedTotal)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{unpaidRows.length.toLocaleString()} open bills →</div>
          </Link>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {/* Paid spend per month/week/day — tap a bar to drill in. */}
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Spend by {bucketNoun}</h2>
              {avgPerBucket > 0 && (
                <div className="text-[11px] text-muted-foreground">
                  avg {fmt(avgPerBucket)}/{bucketNoun}
                </div>
              )}
            </div>
            <div className="mt-3 flex items-end gap-[3px]">
              {buckets.map(b => {
                const value = paidByBucket.get(b.key) || 0;
                // Returns/credits can net a bucket below zero — clamp the bar,
                // the label still shows the signed number.
                const barPx = maxBucket > 0 ? Math.round((Math.max(value, 0) / maxBucket) * 80) : 0;
                const column = (
                  <>
                    <span className="text-[9px] leading-none text-muted-foreground tabular-nums h-[9px]">
                      {value !== 0 ? kfmt(value) : ""}
                    </span>
                    <div
                      className={`w-full max-w-[30px] rounded-t-[4px] ${
                        value > 0 ? (b.isCurrent ? "bg-amber-500" : "bg-amber-500/65") : "bg-muted"
                      }`}
                      style={{ height: `${value > 0 ? Math.max(barPx, 3) : 2}px` }}
                    />
                    <span className={`text-[9px] leading-none ${b.isCurrent ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                      {b.tick}
                    </span>
                  </>
                );
                const colClass = "flex-1 min-w-0 flex flex-col items-center justify-end gap-1";
                return b.href ? (
                  <Link key={b.key} href={b.href} title={`${b.label}: ${fmt(value)}`} className={`${colClass} hover:opacity-80`}>
                    {column}
                  </Link>
                ) : (
                  <div key={b.key} title={`${b.label}: ${fmt(value)}`} className={colClass}>
                    {column}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Chart-of-accounts breakdown — tap a row to filter the list below. */}
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Where it went</h2>
              <div className="text-[11px] text-muted-foreground">chart of accounts</div>
            </div>
            <div className="mt-3 flex flex-col gap-2.5">
              {topCats.length === 0 ? (
                <div className="text-[13px] text-muted-foreground">No paid spend in this period.</div>
              ) : (
                topCats.map(({ cat, total, n }) => {
                  const active = catFilter?.key === cat.key;
                  return (
                    <Link
                      key={cat.key}
                      href={`/spent?range=${range}&offset=${offset}${allocQs}${active ? "" : `&cat=${cat.key}`}#transactions`}
                      title={`Books to: ${cat.qbAccount}`}
                      className={`block rounded-md -mx-1.5 px-1.5 py-1 transition-colors ${active ? "bg-muted/60" : "hover:bg-muted/40"}`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${cat.dot}`} />
                          <span className="font-medium truncate">{cat.label}</span>
                          <span className="text-muted-foreground shrink-0">· {n.toLocaleString()}</span>
                        </span>
                        <span className="tabular-nums font-semibold shrink-0">
                          {fmt(total)}
                          <span className="text-muted-foreground font-normal ml-1.5">
                            {totalSpent > 0 ? Math.round((total / totalSpent) * 100) : 0}%
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${cat.dot}`}
                          style={{ width: `${maxCat > 0 ? Math.min(Math.max((total / maxCat) * 100, total > 0 ? 1.5 : 0), 100) : 0}%` }}
                        />
                      </div>
                    </Link>
                  );
                })
              )}
              {restTotal > 0 && (
                <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground px-0">
                  <span>+ {restCats.length} more categories</span>
                  <span className="tabular-nums">{fmt(restTotal)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div id="transactions" className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold">
              {unallocatedOnly ? "On no budget line" : "Transactions"} in {period.label}
              <span className="text-muted-foreground font-normal ml-2 text-[12px]">{listRows.length.toLocaleString()}</span>
              {unallocatedOnly && (
                <span className="text-orange-500 font-semibold ml-2 text-[12px] tabular-nums">
                  {fmt(listRows.reduce((s, r) => s + Number(r.amount || 0), 0))}
                </span>
              )}
            </h2>
            <div className="flex items-center gap-1.5">
              {unallocatedOnly && (
                <Link
                  href={`/spent?range=${range}&offset=${offset}${catQs}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-orange-500/15 text-orange-500"
                >
                  No budget line
                  <X className="h-3 w-3" />
                </Link>
              )}
              {catFilter && (
                <Link
                  href={`/spent?range=${range}&offset=${offset}${allocQs}`}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${catFilter.chip}`}
                >
                  {catFilter.label}
                  <X className="h-3 w-3" />
                </Link>
              )}
            </div>
          </div>
          {unallocatedOnly && (
            <div className="px-4 py-2 border-b bg-orange-500/[0.06] text-[11.5px] text-muted-foreground">
              Invisible to job margin until allocated. Open a bill and pin it to a budget line.
            </div>
          )}
          {listGroups.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              No {catFilter ? `${catFilter.label} ` : ""}transactions{unallocatedOnly ? " on no budget line" : ""} in this period.
            </div>
          ) : (
            listGroups.map(g => (
              <div key={g.bucket.key} className="border-t first:border-t-0">
                <div className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm px-4 py-2 border-b flex items-baseline gap-2">
                  <span className="text-[12px] font-semibold">{g.bucket.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {g.count.toLocaleString()} transaction{g.count === 1 ? "" : "s"}
                  </span>
                  <span className="ml-auto text-[12px] font-semibold tabular-nums">{fmt(g.paid)}</span>
                  {g.open > 0 && <span className="text-[11px] text-red-400 tabular-nums">+ {fmt(g.open)} open</span>}
                </div>
                <div className="divide-y">
                  {g.rows.map(r => {
                    const proj = projOf(r);
                    const unpaid = r.payment_status !== "paid";
                    const overheadRow = isOverheadRow(r);
                    const c = categoryOf.get(r.id)!;
                    // Card-payoff rows come from the bank statement, not the
                    // invoices table — there is no detail page to open.
                    const isBankRow = r.id.startsWith("bank:");
                    const rowClass = "px-4 py-2.5 flex items-center gap-3 hover:bg-muted/40 transition-colors";
                    const rowBody = (
                      <>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[13.5px] font-semibold truncate">{r.vendor_name}</span>
                            {unpaid && (
                              <span className="shrink-0 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[10px] font-semibold uppercase tracking-wider">
                                {r.payment_status === "partial" ? "Partial" : "Unpaid"}
                              </span>
                            )}
                          </div>
                          <div className="text-[12px] mt-0.5 truncate">
                            {overheadRow ? (
                              <span className="text-orange-500 font-medium">Overhead</span>
                            ) : proj ? (
                              <>
                                <span className="text-amber-500 font-medium">{proj.name || proj.project_number}</span>
                                {proj.name && proj.project_number && (
                                  <span className="text-muted-foreground"> · {proj.project_number}</span>
                                )}
                              </>
                            ) : (
                              <span className="text-muted-foreground italic">No project</span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5 min-w-0">
                            <span className="shrink-0">
                              {r.invoice_date ? shortDate(parseDate(r.invoice_date)) : "no date"}
                            </span>
                            {r.invoice_number && <span className="truncate">· Inv {r.invoice_number}</span>}
                            {(r.split_count ?? 1) > 1 && (
                              <span className="shrink-0 px-1.5 py-px rounded-full bg-sky-500/15 text-sky-400 text-[9.5px] font-semibold uppercase tracking-wide">
                                Split · {r.split_count} lines
                              </span>
                            )}
                            <CatChip cat={c} />
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-[14px] font-semibold tabular-nums">
                          {fmt(effAmt(r))}
                        </div>
                      </>
                    );
                    return isBankRow ? (
                      <div key={r.id} className={rowClass}>{rowBody}</div>
                    ) : (
                      <Link key={r.id} href={`/spent/${r.id}`} className={rowClass}>{rowBody}</Link>
                    );
                  })}
                  {g.hidden > 0 && g.bucket.href && (
                    <Link
                      href={`${g.bucket.href}${catQs}${allocQs}`}
                      className="block px-4 py-2.5 text-[12px] font-medium text-amber-500 hover:bg-muted/40 transition-colors"
                    >
                      + {g.hidden.toLocaleString()} more in {g.bucket.label} — open the month →
                    </Link>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
