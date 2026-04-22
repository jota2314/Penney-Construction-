import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ArrowUpRight } from "lucide-react";
import { computePeriod, type TimeRange } from "@/lib/time-range";

export const metadata: Metadata = { title: "Payments Received | Penney Construction" };

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

const VALID_RANGES: ReadonlyArray<TimeRange> = ["week", "month", "quarter", "year"];

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string; offset?: string }>;
}) {
  await requireAuth();
  const params = (await searchParams) || {};
  const range: TimeRange = (VALID_RANGES as ReadonlyArray<string>).includes(params.range || "")
    ? (params.range as TimeRange)
    : "year";
  const offset = Number.parseInt(params.offset || "0", 10) || 0;

  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const period = computePeriod(range, offset, nowET);
  const periodStartDate = period.start.slice(0, 10);
  const periodEndDate = period.end.slice(0, 10);

  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("payments_received")
    .select("id, project_id, payment_type, description, amount, received_date, method, reference_number, notes, projects(name, project_number)")
    .gte("received_date", periodStartDate)
    .lte("received_date", periodEndDate)
    .order("received_date", { ascending: false })
    .limit(500);

  const payments = rows ?? [];
  const total = payments.reduce((s, r) => s + Number(r.amount || 0), 0);

  const RANGE_BUTTONS: { label: string; value: TimeRange }[] = [
    { label: "Week", value: "week" },
    { label: "Month", value: "month" },
    { label: "Quarter", value: "quarter" },
    { label: "Year", value: "year" },
  ];

  return (
    <>
      <Header title="Payments Received" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8 overflow-auto">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Period</div>
            <div className="text-[15px] font-semibold">{period.label}</div>
          </div>
          <div className="flex bg-muted rounded-lg p-0.5 flex-wrap">
            {RANGE_BUTTONS.map(b => (
              <Link
                key={b.value}
                href={`/payments?range=${b.value}&offset=0`}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  range === b.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {b.label}
              </Link>
            ))}
            <Link
              href={`/payments?range=${range}&offset=${offset - 1}`}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground"
            >
              ←
            </Link>
            <Link
              href={`/payments?range=${range}&offset=${offset + 1}`}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground"
            >
              →
            </Link>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total received in {period.label}</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-emerald-500">{fmt(total)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{payments.length} payments</div>
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold">Payments in {period.label}</h2>
          </div>
          <div className="divide-y">
            {payments.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No payments in this period.</div>
            ) : payments.map(r => {
              const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects;
              return (
                <div key={r.id} className="px-4 py-3 flex items-center gap-4 hover:bg-muted/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold truncate">
                      {r.description || r.payment_type || "Payment"}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground truncate">
                      {r.received_date ? new Date(r.received_date).toLocaleDateString() : ""}
                      {r.method ? ` · ${r.method}` : ""}
                      {r.reference_number ? ` · #${r.reference_number}` : ""}
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
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="shrink-0 w-[100px] text-right text-[14px] font-semibold tabular-nums text-emerald-500">
                    {fmt(Number(r.amount || 0))}
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
