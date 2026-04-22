import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ArrowUpRight } from "lucide-react";

export const metadata: Metadata = { title: "Payments Received | Penney Construction" };

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

export default async function PaymentsPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("payments_received")
    .select("id, project_id, payment_type, description, amount, received_date, method, reference_number, notes, projects(name, project_number)")
    .order("received_date", { ascending: false })
    .limit(200);

  const payments = rows ?? [];
  const total = payments.reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <>
      <Header title="Payments Received" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 overflow-auto">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total received</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-emerald-500">{fmt(total)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{payments.length} payments</div>
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold">Recent payments</h2>
          </div>
          <div className="divide-y">
            {payments.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No payments recorded yet.</div>
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
