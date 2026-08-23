import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ArrowUpRight } from "lucide-react";
import { computePeriod, type TimeRange } from "@/lib/time-range";
import { FinanceTabs } from "@/components/finances/finance-tabs";

export const metadata: Metadata = { title: "Finances — Income | Penney Construction" };

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

const VALID_RANGES: ReadonlyArray<TimeRange> = ["week", "month", "quarter", "year"];

// ---- Classification -------------------------------------------------------
// Every payment lands in exactly one class. change_order_id wins over
// payment_type; "draw" and "progress" are the same stage under two names.

type PayClass = "deposit" | "progress" | "final" | "change_order";

const CLASS_ORDER: PayClass[] = ["deposit", "progress", "final", "change_order"];

const CLASS_META: Record<PayClass, { tile: string; chip: string; chipClass: string; dot: string }> = {
  deposit: {
    tile: "Deposits",
    chip: "Deposit",
    chipClass: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    dot: "bg-sky-500",
  },
  progress: {
    tile: "Progress draws",
    chip: "Progress",
    chipClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  final: {
    tile: "Final payments",
    chip: "Final",
    chipClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  change_order: {
    tile: "Change orders",
    chip: "CO",
    chipClass: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    dot: "bg-violet-500",
  },
};

type PaymentRow = {
  id: string;
  project_id: string | null;
  payment_type: string | null;
  description: string | null;
  amount: number | string | null;
  received_date: string | null;
  method: string | null;
  reference_number: string | null;
  payer_name: string | null;
  source: string | null;
  change_order_id: string | null;
  client_invoice_id: string | null;
  projects: { name: string | null; project_number: string | null } | { name: string | null; project_number: string | null }[] | null;
};

function classify(r: PaymentRow): PayClass {
  if (r.change_order_id) return "change_order";
  if (r.payment_type === "deposit") return "deposit";
  if (r.payment_type === "final") return "final";
  return "progress"; // draw, progress, and anything unlabeled mid-job
}

// How the payment got into the books — the trust trail behind the row.
function sourceBadge(r: PaymentRow): string | null {
  if (r.source === "deposit_capture") return "Check photo";
  if (r.source === "invoice_paid" || r.client_invoice_id) return "Invoice";
  if (r.source && r.source.includes("ledger")) return "Ledger-verified";
  if (r.source === "qb_import") return "QuickBooks";
  return null;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// received_date is a plain YYYY-MM-DD; format from the string so the label
// never shifts a day across timezones.
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}

function dayLabel(d: string): string {
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string; offset?: string; type?: string }>;
}) {
  await requireAuth();
  const params = (await searchParams) || {};
  const range: TimeRange = (VALID_RANGES as ReadonlyArray<string>).includes(params.range || "")
    ? (params.range as TimeRange)
    : "year";
  const offset = Number.parseInt(params.offset || "0", 10) || 0;
  const typeFilter: PayClass | null = (CLASS_ORDER as ReadonlyArray<string>).includes(params.type || "")
    ? (params.type as PayClass)
    : null;

  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const period = computePeriod(range, offset, nowET);
  const periodStartDate = period.start.slice(0, 10);
  const periodEndDate = period.end.slice(0, 10);

  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("payments_received")
    .select(
      "id, project_id, payment_type, description, amount, received_date, method, reference_number, payer_name, source, change_order_id, client_invoice_id, projects(name, project_number)"
    )
    .gte("received_date", periodStartDate)
    .lte("received_date", periodEndDate)
    .order("received_date", { ascending: false })
    .limit(500);

  const all = (rows ?? []) as PaymentRow[];
  const total = all.reduce((s, r) => s + Number(r.amount || 0), 0);

  // Per-class rollup over the whole period (independent of the active filter,
  // so the tiles always show the full picture).
  const byClass = new Map<PayClass, { count: number; total: number }>();
  for (const c of CLASS_ORDER) byClass.set(c, { count: 0, total: 0 });
  for (const r of all) {
    const bucket = byClass.get(classify(r))!;
    bucket.count += 1;
    bucket.total += Number(r.amount || 0);
  }

  const payments = typeFilter ? all.filter(r => classify(r) === typeFilter) : all;
  const filteredTotal = payments.reduce((s, r) => s + Number(r.amount || 0), 0);

  // Group by month, newest first (rows are already date-desc).
  const monthGroups: { ym: string; rows: PaymentRow[]; total: number }[] = [];
  for (const r of payments) {
    const ym = (r.received_date || "").slice(0, 7) || "unknown";
    const last = monthGroups[monthGroups.length - 1];
    if (last && last.ym === ym) {
      last.rows.push(r);
      last.total += Number(r.amount || 0);
    } else {
      monthGroups.push({ ym, rows: [r], total: Number(r.amount || 0) });
    }
  }

  // Deliberately NOT scoped to the period: a check the AI half-read is work
  // waiting, and it shouldn't disappear from view because you flipped to Week.
  const { count: needsReview } = await supabase
    .from("payments_received")
    .select("id", { count: "exact", head: true })
    .eq("review_status", "needs_review");

  const RANGE_BUTTONS: { label: string; value: TimeRange }[] = [
    { label: "Week", value: "week" },
    { label: "Month", value: "month" },
    { label: "Quarter", value: "quarter" },
    { label: "Year", value: "year" },
  ];

  const baseQS = `range=${range}&offset=${offset}`;

  return (
    <>
      <Header title="Finances" backHref="/command-center" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        <FinanceTabs current="income" />
        {(needsReview ?? 0) > 0 && (
          <Link
            href="/payments/review"
            className="flex items-center justify-between gap-3 rounded-xl border border-amber-600/40 bg-amber-600/10 px-4 py-3"
          >
            <div>
              <div className="text-sm font-semibold text-amber-600">
                {needsReview} payment{needsReview === 1 ? "" : "s"} to check
              </div>
              <div className="text-xs text-muted-foreground">
                Logged off a check photo — the AI wasn&apos;t sure about the payer, job or amount
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
                href={`/payments?range=${b.value}&offset=0${typeFilter ? `&type=${typeFilter}` : ""}`}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  range === b.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {b.label}
              </Link>
            ))}
            <Link
              href={`/payments?range=${range}&offset=${offset - 1}${typeFilter ? `&type=${typeFilter}` : ""}`}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground"
            >
              ←
            </Link>
            <Link
              href={`/payments?range=${range}&offset=${offset + 1}${typeFilter ? `&type=${typeFilter}` : ""}`}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground"
            >
              →
            </Link>
          </div>
        </div>

        {/* Total + classification tiles. Tap a tile to filter to that class. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <Link
            href={`/payments?${baseQS}`}
            className={`rounded-lg border bg-card p-3 sm:p-4 transition-colors ${
              typeFilter === null ? "border-amber-600/60 ring-1 ring-amber-600/40" : "hover:bg-muted/40"
            }`}
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">All received</div>
            <div className="text-lg sm:text-xl font-bold tabular-nums mt-1 text-emerald-500">{fmt(total)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{all.length} payment{all.length === 1 ? "" : "s"}</div>
          </Link>
          {CLASS_ORDER.map(c => {
            const meta = CLASS_META[c];
            const b = byClass.get(c)!;
            const active = typeFilter === c;
            return (
              <Link
                key={c}
                href={`/payments?${baseQS}&type=${c}`}
                className={`rounded-lg border bg-card p-3 sm:p-4 transition-colors ${
                  active ? "border-amber-600/60 ring-1 ring-amber-600/40" : "hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{meta.tile}</div>
                </div>
                <div className="text-lg sm:text-xl font-bold tabular-nums mt-1">{fmt(b.total)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{b.count} payment{b.count === 1 ? "" : "s"}</div>
              </Link>
            );
          })}
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              {typeFilter ? `${CLASS_META[typeFilter].tile} in ${period.label}` : `Payments in ${period.label}`}
            </h2>
            {typeFilter && (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold tabular-nums text-emerald-500">{fmt(filteredTotal)}</span>
                <Link href={`/payments?${baseQS}`} className="text-muted-foreground hover:text-foreground underline">
                  Clear
                </Link>
              </div>
            )}
          </div>
          {payments.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">No payments in this period.</div>
          ) : (
            monthGroups.map(g => (
              <div key={g.ym}>
                <div className="px-4 py-2 bg-muted/40 border-b flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                    {g.ym === "unknown" ? "No date" : monthLabel(g.ym)}
                  </div>
                  <div className="text-[12px] font-semibold tabular-nums text-emerald-500">{fmt(g.total)}</div>
                </div>
                <div className="divide-y">
                  {g.rows.map(r => {
                    const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects;
                    const cls = classify(r);
                    const meta = CLASS_META[cls];
                    const badge = sourceBadge(r);
                    return (
                      <div key={r.id} className="px-4 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors">
                        <span
                          className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${meta.chipClass}`}
                        >
                          {meta.chip}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13.5px] font-semibold truncate">
                            {r.payer_name || r.description || r.payment_type || "Payment"}
                          </div>
                          <div className="text-[11.5px] text-muted-foreground truncate">
                            {r.received_date ? dayLabel(r.received_date) : ""}
                            {r.method ? ` · ${r.method}` : ""}
                            {r.reference_number ? ` · #${r.reference_number}` : ""}
                            {badge ? ` · ${badge}` : ""}
                          </div>
                          {proj && (
                            <Link
                              href={`/projects/${r.project_id}`}
                              className="sm:hidden mt-0.5 inline-flex items-center gap-1 text-[11px] text-amber-500"
                            >
                              <span className="truncate">{proj.project_number || proj.name}</span>
                              <ArrowUpRight className="h-2.5 w-2.5 shrink-0" />
                            </Link>
                          )}
                        </div>
                        <div className="shrink-0 text-[12px] hidden sm:block">
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
                        <div className="shrink-0 w-[92px] sm:w-[100px] text-right text-[14px] font-semibold tabular-nums text-emerald-500">
                          {fmt(Number(r.amount || 0))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <p className="text-[11px] text-muted-foreground px-1">
          Every payment is classified by stage: deposit, progress draw, final, or change order. Tap a tile to filter.
          &quot;Ledger-verified&quot; means the row was matched against Nicole&apos;s ledgers or the bank audit; &quot;Check
          photo&quot; came from a captured check; &quot;Invoice&quot; is tied to a sent client invoice.
        </p>
      </div>
    </>
  );
}
