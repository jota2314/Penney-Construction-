import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { AlertTriangle, Camera, ArrowUpRight } from "lucide-react";

export const metadata: Metadata = { title: "Invoices | Penney Construction" };

/**
 * Every bill Penney OWES — sub invoices, supplier invoices, and receipts the
 * crew photographed in the field. Money IN lives on the client invoice flow in
 * the project Finances tab; do not mix the two here.
 *
 * Anything the AI flagged sorts to the top: a wrong number sitting inside the
 * job's Spent is the one thing on this page that costs money to ignore.
 */

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n || 0);

const STATUS_STYLE: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  partial: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  unpaid: "bg-muted text-muted-foreground",
};

export default async function InvoicesPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data } = await supabase
    .from("invoices")
    .select(
      "id, vendor_name, vendor_type, trade, invoice_number, invoice_date, amount, paid_amount, payment_status, review_status, review_reason, source, project_id, projects(name, project_number)",
    )
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .limit(300);

  const rows = data ?? [];

  // Flagged first, then newest. Sorting here rather than in SQL keeps it to one
  // query — the page is capped at 300 rows, so this is free.
  const sorted = [...rows].sort((a, b) => {
    const aFlag = a.review_status === "needs_review" ? 0 : 1;
    const bFlag = b.review_status === "needs_review" ? 0 : 1;
    if (aFlag !== bFlag) return aFlag - bFlag;
    return (b.invoice_date ?? "").localeCompare(a.invoice_date ?? "");
  });

  const flaggedCount = rows.filter((r) => r.review_status === "needs_review").length;
  const outstanding = rows
    .filter((r) => r.payment_status !== "paid")
    .reduce((sum, r) => sum + (Number(r.amount || 0) - Number(r.paid_amount || 0)), 0);
  const paidTotal = rows
    .filter((r) => r.payment_status === "paid")
    .reduce((sum, r) => sum + Number(r.paid_amount || r.amount || 0), 0);

  return (
    <>
      <Header title="Invoices" backHref="/command-center" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        {flaggedCount > 0 && (
          <Link
            href="/spent/review"
            className="flex items-center justify-between gap-3 rounded-xl border border-amber-600/40 bg-amber-600/10 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <div className="text-sm font-semibold text-amber-600">
                  {flaggedCount} receipt{flaggedCount === 1 ? "" : "s"} to check
                </div>
                <div className="text-xs text-muted-foreground">
                  Captured in the field — already counted in Spent, but unconfirmed
                </div>
              </div>
            </div>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-amber-600" />
          </Link>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Outstanding
            </div>
            <div className="text-xl font-semibold mt-1">{fmt(outstanding)}</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Paid
            </div>
            <div className="text-xl font-semibold mt-1">{fmt(paidTotal)}</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Bills
            </div>
            <div className="text-xl font-semibold mt-1">{rows.length}</div>
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center">
            <div className="text-sm font-medium">No invoices yet</div>
            <div className="text-xs text-muted-foreground mt-1">
              Sub bills, supplier invoices and field receipts all land here.
            </div>
          </div>
        ) : (
          <div className="rounded-xl border bg-card overflow-hidden">
            {sorted.map((row, i) => {
              const project = (Array.isArray(row.projects) ? row.projects[0] : row.projects) as
                | { name: string; project_number: string | null }
                | null;
              const flagged = row.review_status === "needs_review";
              return (
                <Link
                  key={row.id}
                  href={`/spent/${row.id}`}
                  className={`flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50 transition-colors ${
                    i > 0 ? "border-t" : ""
                  } ${flagged ? "bg-amber-500/5" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      {row.source === "field_capture" && (
                        <Camera className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium truncate">{row.vendor_name}</span>
                      {flagged && (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                          Check
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {project
                        ? [project.project_number, project.name].filter(Boolean).join(" ")
                        : "Overhead — no job"}
                      {row.trade ? ` · ${row.trade}` : ""}
                      {row.invoice_date ? ` · ${row.invoice_date}` : ""}
                    </div>
                    {flagged && row.review_reason && (
                      <div className="text-[11px] text-amber-600 truncate mt-0.5">
                        {row.review_reason}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold">{fmt(Number(row.amount || 0))}</div>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide mt-0.5 ${
                        STATUS_STYLE[row.payment_status] ?? STATUS_STYLE.unpaid
                      }`}
                    >
                      {row.payment_status}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
