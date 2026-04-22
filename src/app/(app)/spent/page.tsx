import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ArrowUpRight } from "lucide-react";
import { computePeriod, type TimeRange } from "@/lib/actions/command-center-v2";

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

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, vendor_name, vendor_type, trade, invoice_number, amount, paid_amount, invoice_date, payment_status, project_id, projects(name, project_number)")
    .eq("payment_status", "paid")
    .gte("invoice_date", periodStartDate)
    .lte("invoice_date", periodEndDate)
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .limit(500);

  const rows = invoices ?? [];

  const totalSpent = rows.reduce((s, r) => s + Number(r.paid_amount || r.amount || 0), 0);
  const overhead = rows.filter(r => !r.project_id);
  const projectSpent = rows.filter(r => !!r.project_id);
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
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 overflow-auto">
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total spent</div>
            <div className="text-2xl font-bold tabular-nums mt-1">{fmt(totalSpent)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{rows.length} paid transactions</div>
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
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold">Transactions in {period.label}</h2>
          </div>
          <div className="divide-y">
            {rows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No paid invoices in this period.</div>
            ) : rows.map(r => {
              const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects;
              return (
                <div key={r.id} className="px-4 py-3 flex items-center gap-4 hover:bg-muted/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold truncate">{r.vendor_name}</div>
                    <div className="text-[11.5px] text-muted-foreground truncate">
                      {r.invoice_number ? `Inv ${r.invoice_number} · ` : ""}
                      {r.invoice_date ? new Date(r.invoice_date).toLocaleDateString() : "no date"}
                      {r.trade ? ` · ${r.trade}` : r.vendor_type ? ` · ${r.vendor_type}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-[12px]">
                    {proj ? (
                      <Link
                        href={`/projects/${r.project_id}`}
                        className="inline-flex items-center gap-1 text-amber-500 hover:underline"
                      >
                        {proj.project_number || proj.name}
                        <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-500 text-[10px] font-semibold uppercase tracking-wider">
                        Overhead
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 w-[100px] text-right text-[14px] font-semibold tabular-nums">
                    {fmt(Number(r.paid_amount || r.amount || 0))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
