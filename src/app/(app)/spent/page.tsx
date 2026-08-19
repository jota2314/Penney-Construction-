import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ArrowUpRight } from "lucide-react";
import { computePeriod, type TimeRange } from "@/lib/time-range";
import { countCapturesForReview } from "@/lib/actions/field-capture";

export const metadata: Metadata = { title: "Spent | Penney Construction" };

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

const VALID_RANGES: ReadonlyArray<TimeRange> = ["week", "month", "quarter", "year"];

export default async function SpentPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string; offset?: string }>;
}) {
  await requireAuth();
  const params = (await searchParams) || {};
  const range: TimeRange = (VALID_RANGES as ReadonlyArray<string>).includes(params.range || "")
    ? (params.range as TimeRange)
    : "year"; // default to full year when no range given
  const offset = Number.parseInt(params.offset || "0", 10) || 0;

  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const period = computePeriod(range, offset, nowET);
  const periodStartDate = period.start.slice(0, 10);
  const periodEndDate = period.end.slice(0, 10);

  const supabase = await createClient();

  // EVERYTHING shows here — paid receipts, unpaid bills, on-account tickets.
  // Jorge 8/19: "the bill, the gas, the receipts — everything needs to be
  // here in spending." Paid rows make the Spent total; unpaid rows make the
  // Owed total and wear a chip in the list.
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, vendor_name, vendor_type, trade, invoice_number, amount, paid_amount, invoice_date, payment_status, project_id, projects(name, project_number, is_overhead)")
    .gte("invoice_date", periodStartDate)
    .lte("invoice_date", periodEndDate)
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .limit(500);

  const rows = invoices ?? [];

  // Field captures the AI flagged. They are already inside the totals below,
  // so the banner is a correction prompt, not a "pending" bucket.
  const needsReview = await countCapturesForReview();

  // Overhead = the Office — Overhead project (is_overhead) OR legacy rows
  // with no project at all. Filtering on !project_id alone reads $0 forever,
  // because overhead bills carry PC-2026-179 since July.
  const isOverheadRow = (r: (typeof rows)[number]): boolean => {
    const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    return !r.project_id || Boolean((proj as { is_overhead?: boolean | null } | null)?.is_overhead);
  };

  const paidRows = rows.filter(r => r.payment_status === "paid");
  const unpaidRows = rows.filter(r => r.payment_status !== "paid");
  const totalSpent = paidRows.reduce((s, r) => s + Number(r.paid_amount || r.amount || 0), 0);
  const owedTotal = unpaidRows.reduce((s, r) => s + (Number(r.amount || 0) - Number(r.paid_amount || 0)), 0);
  const overhead = paidRows.filter(isOverheadRow);
  const projectSpent = paidRows.filter(r => !isOverheadRow(r));
  const overheadTotal = overhead.reduce((s, r) => s + Number(r.paid_amount || r.amount || 0), 0);
  const projectTotal = projectSpent.reduce((s, r) => s + Number(r.paid_amount || r.amount || 0), 0);

  // Period switcher (plain links — simple, no client JS needed).
  const RANGE_BUTTONS: { label: string; value: TimeRange }[] = [
    { label: "Week", value: "week" },
    { label: "Month", value: "month" },
    { label: "Quarter", value: "quarter" },
    { label: "Year", value: "year" },
  ];

  return (
    <>
      <Header title="Spent" backHref="/command-center" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        {needsReview > 0 && (
          <Link
            href="/spent/review"
            className="flex items-center justify-between gap-3 rounded-xl border border-amber-600/40 bg-amber-600/10 px-4 py-3"
          >
            <div>
              <div className="text-sm font-semibold text-amber-600">
                {needsReview} receipt{needsReview === 1 ? "" : "s"} to check
              </div>
              <div className="text-xs text-muted-foreground">
                Captured in the field — the AI wasn&apos;t sure about the job, vendor or amount
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
                href={`/spent?range=${b.value}&offset=0`}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  range === b.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {b.label}
              </Link>
            ))}
            <Link
              href={`/spent?range=${range}&offset=${offset - 1}`}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground"
            >
              ←
            </Link>
            <Link
              href={`/spent?range=${range}&offset=${offset + 1}`}
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
            <div className="text-xs text-muted-foreground mt-0.5">{paidRows.length} paid transactions</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">On projects</div>
            <div className="text-2xl font-bold tabular-nums mt-1 text-amber-500">{fmt(projectTotal)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{projectSpent.length} invoices</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Overhead</div>
            <div className="text-2xl font-bold tabular-nums mt-1 text-orange-500">{fmt(overheadTotal)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{overhead.length} invoices</div>
          </div>
          <Link href="/invoices?tab=unpaid" className="rounded-lg border bg-card p-4 hover:bg-muted/40 transition-colors">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Owed (unpaid)</div>
            <div className="text-2xl font-bold tabular-nums mt-1 text-red-400">{fmt(owedTotal)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{unpaidRows.length} open bills →</div>
          </Link>
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold">Transactions in {period.label}</h2>
          </div>
          <div className="divide-y">
            {rows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No transactions in this period.</div>
            ) : rows.map(r => {
              const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects;
              const unpaid = r.payment_status !== "paid";
              return (
                <Link
                  key={r.id}
                  href={`/spent/${r.id}`}
                  className="px-4 py-3 flex items-center gap-4 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[13.5px] font-semibold truncate">{r.vendor_name}</span>
                      {unpaid && (
                        <span className="shrink-0 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[10px] font-semibold uppercase tracking-wider">
                          {r.payment_status === "partial" ? "Partial" : "Unpaid"}
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground truncate">
                      {r.invoice_number ? `Inv ${r.invoice_number} · ` : ""}
                      {r.invoice_date ? new Date(r.invoice_date).toLocaleDateString() : "no date"}
                      {r.trade ? ` · ${r.trade}` : r.vendor_type ? ` · ${r.vendor_type}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-[12px]">
                    {isOverheadRow(r) ? (
                      <span className="px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-500 text-[10px] font-semibold uppercase tracking-wider">
                        Overhead
                      </span>
                    ) : proj ? (
                      <span className="inline-flex items-center gap-1 text-amber-500">
                        {proj.project_number || proj.name}
                      </span>
                    ) : null}
                  </div>
                  <div className="shrink-0 w-[100px] text-right text-[14px] font-semibold tabular-nums">
                    {fmt(Number(unpaid ? r.amount : r.paid_amount || r.amount) || 0)}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
