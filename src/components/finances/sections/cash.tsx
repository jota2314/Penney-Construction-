import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { financialRows } from "@/lib/crew/load-labor-ledger";
import { formatMoney } from "@/lib/money";
import { summarizeCashFlow } from "@/lib/finance/overview-cash";
import { getFinanceWorkspace } from "@/lib/finance/workspace-data";
import { CollectionPlanDialog } from "@/components/ceo/collection-plan-dialog";
import { publishedCollectionPlan } from "@/lib/finance/published-collection-plan";
import { getCollectionInvoices } from "@/lib/finance/collection-invoices";
import { CashActivity } from "@/components/finances/cash-activity";

export default async function CashPage({ searchParams }: {
  searchParams?: Promise<{ m?: string }>;
}) {
  const user = await requireAuth();
  if (!canSeeBoardMoney(user.profile?.role)) redirect("/command-center");
  const params = (await searchParams) || {};
  const db = await createClient();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const start = today.slice(0, 4) + "-01-01";
  // A failed page fails the section, never turning a partial inventory into a total.
  const [bank, receipts, bills, workspace, collectionInvoices] = await Promise.all([
    financialRows((from, to) => db.from("bank_transactions")
      .select("id, source, txn_date, amount, direction, description, category_key, check_number")
      .like("source", "eastern%").gte("txn_date", start).lte("txn_date", today)
      .order("id").range(from, to)),
    financialRows((from, to) => db.from("payments_received")
      .select("id, received_date, amount").gte("received_date", start).lte("received_date", today)
      .order("id").range(from, to)),
    // Older bills can be paid this year. Missing/backfilled payment dates remain visible.
    financialRows((from, to) => db.from("invoices")
      .select("id, invoice_date, paid_date, paid_date_source, amount, paid_amount, payment_status, payment_method, duplicate_of_id")
      .is("duplicate_of_id", null).in("payment_status", ["paid", "partial"])
      .order("id").range(from, to)),
    getFinanceWorkspace(), getCollectionInvoices(),
  ]);
  const cash = summarizeCashFlow(receipts, bills, bank, today);
  const owedToUs = workspace.collections.filter(row => !row.issue)
    .reduce((sum, row) => sum + row.balance, 0) / 100;
  const vendorTotals = new Map<string, number>();
  for (const bill of workspace.bills.bills) {
    vendorTotals.set(bill.vendor, (vendorTotals.get(bill.vendor) ?? 0) + bill.amount);
  }
  const vendors = [...vendorTotals].sort((a, b) => b[1] - a[1]).slice(0, 8);

  return <div className="flex min-w-0 flex-col gap-5">
    <CashActivity cash={cash} today={today} month={params.m} />
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="@container min-w-0 rounded-xl border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Owed to us</h2>
        <div className="mt-1 text-[clamp(1rem,10cqi,1.875rem)] font-bold tabular-nums text-sky-400 [overflow-wrap:anywhere]">{formatMoney(owedToUs)}</div>
        <p className="mt-1 text-xs text-muted-foreground">Issued invoices · recorded open balances</p>
        <CollectionPlanDialog plan={publishedCollectionPlan} invoiceProjects={collectionInvoices}
          triggerClassName="mt-3 text-sm font-medium text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          View collection plan &amp; invoices →
        </CollectionPlanDialog>
      </section>
      <section className="@container min-w-0 rounded-xl border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold">We owe</h2>
        <div className="mt-1 text-[clamp(1rem,10cqi,1.875rem)] font-bold tabular-nums text-red-400 [overflow-wrap:anywhere]">{formatMoney(workspace.bills.total)}</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Reviewed open balances; see Bills for approval status.
          {workspace.bills.reviewBalance > 0 && <> {formatMoney(workspace.bills.reviewBalance)} in unresolved balances needs review.</>}
        </p>
        <div className="mt-3 space-y-2 text-xs">
          {vendors.map(([vendor, amount]) => <div key={vendor} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{vendor}</span><span className="shrink-0 tabular-nums">{formatMoney(amount)}</span>
          </div>)}
        </div>
        <Link href="/finances?section=bills" className="mt-3 inline-block text-sm font-medium text-amber-500">All open bills →</Link>
      </section>
    </div>
  </div>;
}
