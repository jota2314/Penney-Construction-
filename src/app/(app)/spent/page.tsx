import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ArrowUpRight } from "lucide-react";

export const metadata: Metadata = { title: "Spent | Penney Construction" };

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

export default async function SpentPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, vendor_name, invoice_number, amount, paid_amount, invoice_date, payment_status, category, project_id, projects(name, project_number)")
    .eq("payment_status", "paid")
    .order("invoice_date", { ascending: false })
    .limit(200);

  const rows = invoices ?? [];

  const totalSpent = rows.reduce((s, r) => s + Number(r.paid_amount || r.amount || 0), 0);

  // Split by overhead vs project — if there's no project_id it's overhead.
  const overhead = rows.filter(r => !r.project_id);
  const projectSpent = rows.filter(r => !!r.project_id);
  const overheadTotal = overhead.reduce((s, r) => s + Number(r.paid_amount || r.amount || 0), 0);
  const projectTotal = projectSpent.reduce((s, r) => s + Number(r.paid_amount || r.amount || 0), 0);

  return (
    <>
      <Header title="Spent" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 overflow-auto">
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
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Transactions · last 200</h2>
            <div className="text-[11px] text-muted-foreground">
              QuickBooks sync coming — for now: tied to invoices already in the app.
            </div>
          </div>
          <div className="divide-y">
            {rows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No paid invoices yet.</div>
            ) : rows.map(r => {
              const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects;
              return (
                <div key={r.id} className="px-4 py-3 flex items-center gap-4 hover:bg-muted/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold truncate">{r.vendor_name}</div>
                    <div className="text-[11.5px] text-muted-foreground truncate">
                      {r.invoice_number ? `Inv ${r.invoice_number} · ` : ""}
                      {r.invoice_date ? new Date(r.invoice_date).toLocaleDateString() : ""}
                      {r.category ? ` · ${r.category}` : ""}
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
