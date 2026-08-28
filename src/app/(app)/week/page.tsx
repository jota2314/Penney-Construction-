import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { computePeriod, type TimeRange } from "@/lib/time-range";
import { spendCategoryFor, type SpendCategory } from "@/lib/finance/spend-category";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { FinanceTabs } from "@/components/finances/finance-tabs";

export const metadata: Metadata = { title: "Finances — Weekly Close | Penney Construction" };

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmt2 = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);

const VALID_RANGES: ReadonlyArray<TimeRange> = ["week", "month", "quarter", "year"];

/** Jobs read by name here, not PC number — the number is the subtitle. */
const jobName = (p: { name?: string | null; project_number?: string | null } | null | undefined) =>
  p?.name || p?.project_number || "Unassigned";

export default async function WeekPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string; offset?: string }>;
}) {
  await requireRole(["owner", "precon_manager", "office_admin"]);
  const params = (await searchParams) || {};
  const range: TimeRange = (VALID_RANGES as ReadonlyArray<string>).includes(params.range || "")
    ? (params.range as TimeRange)
    : "week"; // this page is about the week — /spent and /payments default to year
  const offset = Number.parseInt(params.offset || "0", 10) || 0;

  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const period = computePeriod(range, offset, nowET);
  const startDate = period.start.slice(0, 10);
  const endDate = period.end.slice(0, 10);

  const supabase = await createClient();

  const [{ data: invoiceRows }, { data: paymentRows }, { data: shiftRows }, { data: employeeRows }, { data: billedRows }, { data: breakAdjRows }] =
    await Promise.all([
      // Paged, not .limit(500) — the same silent-truncation bug /spent already
      // had: a busy month/quarter view quietly dropped rows past the cap and
      // under-reported "Money out" with no error.
      fetchAllRows((from, to) =>
        supabase
          .from("invoices")
          .select("id, vendor_name, vendor_type, trade, invoice_number, invoice_date, amount, paid_amount, description, review_status, split_group_id, estimate_line_item_id, project_id, projects(name, project_number, is_overhead), estimate_line_items:estimate_line_item_id(description)")
          .gte("invoice_date", startDate)
          .lte("invoice_date", endDate)
          .order("amount", { ascending: false })
          .order("id")
          .range(from, to)
      ).then((rows) => ({ data: rows })),
      supabase
        .from("payments_received")
        .select("id, amount, received_date, payment_type, description, method, reference_number, project_id, projects(name, project_number)")
        .gte("received_date", startDate)
        .lte("received_date", endDate)
        .order("received_date", { ascending: false })
        .limit(200),
      supabase
        .from("daily_logs")
        .select("id, project_id, author_id, started_at, ended_at, projects(name, project_number, is_overhead, labor_cost_source)")
        .gte("started_at", period.start)
        .lte("started_at", period.end)
        .not("ended_at", "is", null)
        .limit(1000),
      supabase.from("employees").select("profile_id, hourly_rate").not("profile_id", "is", null),
      supabase
        .from("client_invoices")
        // sent_to_client_at, NOT sent_at — the wrong name returned no rows at
        // all and the page quietly reported "nothing billed" on a $168k week.
        .select("id, amount, status, sent_to_client_at, project_id, projects(name, project_number)")
        .gte("sent_to_client_at", period.start)
        .lte("sent_to_client_at", period.end)
        .limit(200),
      // Break overrides — so Crew time deducts the exact same lunches Payroll does.
      supabase
        .from("payroll_adjustments")
        .select("profile_id, work_date, break_minutes")
        .gte("work_date", startDate)
        .lte("work_date", endDate),
    ]);

  const invoices = invoiceRows ?? [];
  const payments = paymentRows ?? [];
  const shifts = shiftRows ?? [];
  const billed = billedRows ?? [];

  const rateByProfile = new Map<string, number>();
  for (const e of employeeRows ?? []) {
    if (e.profile_id) rateByProfile.set(e.profile_id, Number(e.hourly_rate || 0));
  }

  const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? (v[0] as T) ?? null : (v as T) ?? null);
  const projOf = (r: { projects?: unknown }) =>
    one<{ name?: string; project_number?: string; is_overhead?: boolean }>(r.projects);
  const lineOf = (r: { estimate_line_items?: unknown }) =>
    one<{ description?: string }>(r.estimate_line_items);
  const isOverhead = (r: { project_id?: string | null; projects?: unknown }) =>
    !r.project_id || projOf(r)?.is_overhead === true;
  const amt = (r: { amount?: number | string | null }) => Number(r.amount || 0);
  const sum = (rows: Array<{ amount?: number | string | null }>) => rows.reduce((s, r) => s + amt(r), 0);

  // Same rulebook the Spent page and the QuickBooks push use — one place decides.
  const categoryOf = (r: (typeof invoices)[number]): SpendCategory =>
    spendCategoryFor({
      vendorName: r.vendor_name,
      vendorType: r.vendor_type,
      trade: r.trade,
      description: r.description,
      lineItemText: lineOf(r)?.description ?? null,
      isOverhead: isOverhead(r),
    });

  const moneyIn = payments.reduce((s, r) => s + Number(r.amount || 0), 0);
  const moneyOut = sum(invoices);
  const billedOut = billed.reduce((s, r) => s + Number(r.amount || 0), 0);
  const net = moneyIn - moneyOut;

  // ---- spend by category ----
  const catTotals = new Map<string, { cat: SpendCategory; total: number; count: number }>();
  for (const r of invoices) {
    const c = categoryOf(r);
    const g = catTotals.get(c.key) || { cat: c, total: 0, count: 0 };
    g.total += amt(r);
    g.count += 1;
    catTotals.set(c.key, g);
  }
  const categories = [...catTotals.values()].sort((a, b) => b.total - a.total);

  const subsRows = invoices.filter((r) => categoryOf(r).key === "subs");
  const laborRowsInv = invoices.filter((r) => categoryOf(r).key === "labor");
  const overheadRows = invoices.filter(isOverhead);
  const jobSpendRows = invoices.filter((r) => !isOverhead(r) && categoryOf(r).key !== "subs" && categoryOf(r).key !== "labor");

  // ---- job spend grouped by job ----
  const byJob = new Map<string, { label: string; number: string | null; total: number; rows: typeof invoices }>();
  for (const r of jobSpendRows) {
    const key = r.project_id || "unassigned";
    const p = projOf(r);
    const g = byJob.get(key) || { label: jobName(p), number: p?.project_number ?? null, total: 0, rows: [] };
    g.total += amt(r);
    g.rows.push(r);
    byJob.set(key, g);
  }
  const jobGroups = [...byJob.values()].sort((a, b) => b.total - a.total);

  // ---- labor: clock hours vs posted cost ----
  // PAID hours, exactly like Payroll: each worker-day loses its unpaid break
  // (30 min, or that day's payroll_adjustments override), prorated across the
  // day's shifts so per-job splits stay fair. Crew time and the Payroll tab
  // must read the SAME number — Jorge 8/23.
  const DEFAULT_BREAK_MINUTES = 30;
  const dayOf = (iso: string): string =>
    new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const breakOverride = new Map<string, number>();
  for (const a of breakAdjRows ?? []) {
    breakOverride.set(`${a.profile_id}|${a.work_date}`, Number(a.break_minutes ?? 0));
  }
  const timedShift = (s: { started_at: unknown; ended_at: unknown }) => {
    const hrs = (new Date(s.ended_at as string).getTime() - new Date(s.started_at as string).getTime()) / 3_600_000;
    // Zero-length rows are daily-log posts (the crew's "Post update" — they
    // carry the text and photos); the timed rows are the actual punches.
    return hrs > 0.017 ? hrs : 0;
  };
  const rawByWorkerDay = new Map<string, number>();
  for (const s of shifts) {
    const hrs = timedShift(s);
    if (!hrs) continue;
    const key = `${s.author_id}|${dayOf(s.started_at as string)}`;
    rawByWorkerDay.set(key, (rawByWorkerDay.get(key) || 0) + hrs);
  }
  const paidFactor = (workerDayKey: string): number => {
    const raw = rawByWorkerDay.get(workerDayKey) || 0;
    if (raw <= 0) return 0;
    const breakHrs = Math.min((breakOverride.get(workerDayKey) ?? DEFAULT_BREAK_MINUTES) / 60, raw);
    return Math.max(0, raw - breakHrs) / raw;
  };
  const hoursByJob = new Map<string, { label: string; hours: number; wages: number; overhead: boolean; source: string }>();
  for (const s of shifts) {
    const rawHrs = timedShift(s);
    if (!rawHrs) continue;
    const hrs = rawHrs * paidFactor(`${s.author_id}|${dayOf(s.started_at as string)}`);
    const key = s.project_id || "unassigned";
    const p = projOf(s) as { name?: string; project_number?: string; is_overhead?: boolean; labor_cost_source?: string } | null;
    const g = hoursByJob.get(key) || { label: jobName(p), hours: 0, wages: 0, overhead: isOverhead(s), source: p?.labor_cost_source ?? "clock" };
    g.hours += hrs;
    g.wages += hrs * (rateByProfile.get(s.author_id as string) ?? 0);
    hoursByJob.set(key, g);
  }
  const postedByJob = new Map<string, number>();
  for (const r of laborRowsInv) {
    const key = r.project_id || "unassigned";
    postedByJob.set(key, (postedByJob.get(key) || 0) + amt(r));
  }
  const laborRows = [...hoursByJob.entries()]
    .map(([id, g]) => ({ id, ...g, posted: postedByJob.get(id) || 0 }))
    .sort((a, b) => b.wages - a.wages);
  const totalHours = laborRows.reduce((s, r) => s + r.hours, 0);
  const totalClockWages = laborRows.reduce((s, r) => s + r.wages, 0);

  // ---- exceptions ----
  const unallocated = invoices.filter((r) => !r.estimate_line_item_id && !isOverhead(r));
  const needsReview = invoices.filter((r) => r.review_status === "needs_review");
  // Ledger-source jobs get their labor dollars from posted rows; clock-source
  // jobs are costed live from the punches. Only a ledger job with hours and no
  // row anywhere is a real gap — and note those rows are dated when payroll was
  // POSTED, not the week worked, so they can't be matched week-to-week here.
  const noLaborPosted = laborRows.filter((r) => r.source === "ledger" && r.posted === 0 && r.hours > 1);
  const hasExceptions = unallocated.length > 0 || needsReview.length > 0 || noLaborPosted.length > 0;

  const RANGE_BUTTONS: { label: string; value: TimeRange }[] = [
    { label: "Week", value: "week" },
    { label: "Month", value: "month" },
    { label: "Quarter", value: "quarter" },
    { label: "Year", value: "year" },
  ];

  return (
    <>
      <Header title="Finances" backHref="/command-center" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        <FinanceTabs current="weekly" />

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Period</div>
            <div className="text-[15px] font-semibold">{period.label}</div>
          </div>
          <div className="flex bg-muted rounded-lg p-0.5 flex-wrap">
            {RANGE_BUTTONS.map(b => (
              <Link
                key={b.value}
                href={`/week?range=${b.value}&offset=0`}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  range === b.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {b.label}
              </Link>
            ))}
            <Link href={`/week?range=${range}&offset=${offset - 1}`} className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground">←</Link>
            <Link href={`/week?range=${range}&offset=${offset + 1}`} className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground">→</Link>
          </div>
        </div>

        {/* the week in three numbers */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Money in</div>
            <div className="text-2xl font-bold tabular-nums mt-1 text-emerald-500">{fmt(moneyIn)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{payments.length} payment{payments.length === 1 ? "" : "s"} received</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Money out</div>
            <div className="text-2xl font-bold tabular-nums mt-1 text-amber-500">{fmt(moneyOut)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{invoices.length} invoices &amp; receipts</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Net</div>
            <div className={`text-2xl font-bold tabular-nums mt-1 ${net < 0 ? "text-orange-500" : "text-emerald-500"}`}>{fmt(net)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {billedOut > 0 ? `${fmt(billedOut)} billed, not yet collected` : "nothing billed this period"}
            </div>
          </div>
        </div>

        {/* spend by category — same rulebook as /spent and the QBO push */}
        {categories.length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Where it went</div>
            <div className="flex h-2 rounded-full overflow-hidden bg-muted mb-3">
              {categories.map(g => (
                <div key={g.cat.key} className={g.cat.dot} style={{ width: `${(g.total / moneyOut) * 100}%` }} title={`${g.cat.label} ${fmt(g.total)}`} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {categories.map(g => (
                <div key={g.cat.key} className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${g.cat.dot}`} />
                  <span className="text-[12px] text-muted-foreground">{g.cat.label}</span>
                  <span className="text-[12.5px] font-semibold tabular-nums">{fmt(g.total)}</span>
                  <span className="text-[11px] text-muted-foreground">{Math.round((g.total / moneyOut) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* exceptions */}
        {hasExceptions && (
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/[0.04] overflow-hidden">
            <div className="px-4 py-3 border-b border-orange-500/20 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <h2 className="text-sm font-semibold">Before this week can be closed</h2>
            </div>
            <div className="divide-y divide-orange-500/15">
              {noLaborPosted.length > 0 && (
                <div className="px-4 py-3">
                  <div className="text-[13.5px] font-semibold">
                    {noLaborPosted.length} job{noLaborPosted.length === 1 ? "" : "s"} worked with no labor cost posted
                    <span className="ml-2 text-orange-500 tabular-nums">{fmt(noLaborPosted.reduce((s, r) => s + r.wages, 0))}</span>
                  </div>
                  <div className="text-[11.5px] text-muted-foreground mt-0.5">
                    {noLaborPosted.map(r => `${r.label} (${r.hours.toFixed(1)} h)`).join(" · ")}
                  </div>
                </div>
              )}
              {unallocated.length > 0 && (
                <Link href={`/spent?range=${range}&offset=${offset}&unallocated=1#transactions`} className="px-4 py-3 flex items-start gap-3 hover:bg-orange-500/[0.05] transition-colors">
                  <div className="flex-1">
                    <div className="text-[13.5px] font-semibold">
                      {unallocated.length} invoice{unallocated.length === 1 ? "" : "s"} on no budget line
                      <span className="ml-2 text-orange-500 tabular-nums">{fmt(sum(unallocated))}</span>
                    </div>
                    <div className="text-[11.5px] text-muted-foreground mt-0.5">
                      Invisible to job margin until allocated — {unallocated.slice(0, 3).map(r => r.vendor_name).join(", ")}
                      {unallocated.length > 3 ? ` +${unallocated.length - 3} more` : ""}
                    </div>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
                </Link>
              )}
              {needsReview.length > 0 && (
                <Link href="/spent/review" className="px-4 py-3 flex items-start gap-3 hover:bg-orange-500/[0.05] transition-colors">
                  <div className="flex-1">
                    <div className="text-[13.5px] font-semibold">
                      {needsReview.length} receipt{needsReview.length === 1 ? "" : "s"} flagged for review
                      <span className="ml-2 text-orange-500 tabular-nums">{fmt(sum(needsReview))}</span>
                    </div>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
                </Link>
              )}
            </div>
          </div>
        )}

        {/* money in */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Money in</h2>
            <span className="text-[13px] font-semibold tabular-nums text-emerald-500">{fmt2(moneyIn)}</span>
          </div>
          <div className="divide-y">
            {payments.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No payments received in this period.</div>
            ) : payments.map(r => {
              const p = projOf(r);
              return (
                <Link key={r.id} href={r.project_id ? `/projects/${r.project_id}` : "/payments"} className="px-4 py-3 flex items-center gap-4 hover:bg-muted/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold truncate">{jobName(p)}</div>
                    <div className="text-[11.5px] text-muted-foreground truncate">
                      {p?.project_number ? `${p.project_number} · ` : ""}
                      {r.received_date ? new Date(r.received_date).toLocaleDateString() : "no date"}
                      {r.method ? ` · ${r.method}` : ""}
                      {r.reference_number ? ` · ${r.reference_number}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 w-[110px] text-right text-[14px] font-semibold tabular-nums text-emerald-500">{fmt2(Number(r.amount || 0))}</div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* subs */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Payments to subs</h2>
            <span className="text-[13px] font-semibold tabular-nums">{fmt2(sum(subsRows))}</span>
          </div>
          <div className="divide-y">
            {subsRows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No subcontractor payments in this period.</div>
            ) : subsRows.map(r => (
              <Link key={r.id} href={`/spent/${r.id}`} className="px-4 py-3 flex items-center gap-4 hover:bg-muted/40 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold truncate">{r.vendor_name}</div>
                  <div className="text-[11.5px] text-muted-foreground truncate">
                    {jobName(projOf(r))}
                    {r.invoice_number ? ` · Inv ${r.invoice_number}` : ""}
                    {r.description ? ` · ${r.description}` : ""}
                  </div>
                </div>
                <div className="shrink-0 w-[110px] text-right text-[14px] font-semibold tabular-nums">{fmt2(amt(r))}</div>
              </Link>
            ))}
          </div>
        </div>

        {/* material and everything else, by job */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Job spend by job</h2>
            <span className="text-[13px] font-semibold tabular-nums">{fmt2(sum(jobSpendRows))}</span>
          </div>
          <div className="divide-y">
            {jobGroups.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No job spend in this period.</div>
            ) : jobGroups.map(g => (
              <div key={g.label}>
                <div className="px-4 py-2 bg-muted/40 flex items-center justify-between gap-3">
                  <span className="text-[12px] font-semibold truncate">
                    {g.label}
                    {g.number && <span className="ml-2 text-muted-foreground font-normal">{g.number}</span>}
                  </span>
                  <span className="text-[12px] font-semibold tabular-nums shrink-0">{fmt2(g.total)}</span>
                </div>
                {g.rows.map(r => {
                  const c = categoryOf(r);
                  return (
                    <Link key={r.id} href={`/spent/${r.id}`} className="px-4 py-2.5 pl-6 flex items-center gap-3 hover:bg-muted/40 transition-colors">
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.chip}`}>{c.label}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] truncate">{r.vendor_name}{r.invoice_number ? ` · ${r.invoice_number}` : ""}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {lineOf(r)?.description || <span className="text-orange-500">no budget line</span>}
                          {r.description ? ` · ${r.description}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 w-[100px] text-right text-[13px] tabular-nums">{fmt2(amt(r))}</div>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* labor */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold">Crew time</h2>
            <span className="text-[12px] text-muted-foreground tabular-nums">
              {totalHours.toFixed(1)} hours · {fmt2(totalClockWages)} in wages
            </span>
          </div>
          <div className="divide-y">
            {laborRows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No shifts clocked in this period.</div>
            ) : laborRows.map(r => {
              return (
                <div key={r.id} className="px-4 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold truncate">
                      {r.label}
                      {r.overhead && (
                        <span className="ml-2 px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-500 text-[10px] font-semibold uppercase tracking-wider">Overhead</span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground">{r.hours.toFixed(1)} hours</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[14px] font-semibold tabular-nums">{fmt2(r.wages)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-4 py-2.5 border-t text-[11.5px] text-muted-foreground">
            Paid hours this week (breaks deducted, same as the Payroll tab) × each person’s rate. Wages only — payroll tax is company overhead, never job cost. Payroll <em>paid</em> this week shows under Money out, and covers the week before.
          </div>
        </div>

        {/* overhead */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Overhead by category</h2>
            <span className="text-[13px] font-semibold tabular-nums text-orange-500">{fmt2(sum(overheadRows))}</span>
          </div>
          <div className="divide-y">
            {overheadRows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No overhead recorded in this period.</div>
            ) : overheadRows.map(r => {
              const c = categoryOf(r);
              return (
                <Link key={r.id} href={`/spent/${r.id}`} className="px-4 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors">
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.chip}`}>{c.label}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold truncate">
                      {lineOf(r)?.description || <span className="text-orange-500">uncategorised</span>}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground truncate">
                      {r.vendor_name}
                      {r.description ? ` · ${r.description}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 w-[110px] text-right text-[14px] font-semibold tabular-nums">{fmt2(amt(r))}</div>
                </Link>
              );
            })}
          </div>
        </div>

      </div>
    </>
  );
}
