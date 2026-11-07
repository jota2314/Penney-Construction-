import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { financialRows, loadLaborLedger } from "@/lib/crew/load-labor-ledger";
import { formatMoney } from "@/lib/money";
import { buildCashStatement } from "@/lib/finance/cash-statement";
import { getFinanceWorkspace } from "@/lib/finance/workspace-data";
import { isActionableCollection } from "@/lib/finance/workspace-model";
import { CollectionPlanDialog } from "@/components/ceo/collection-plan-dialog";
import { publishedCollectionPlan } from "@/lib/finance/published-collection-plan";
import { getCollectionInvoices } from "@/lib/finance/collection-invoices";
import { CashFlowStatement } from "@/components/finances/cash-flow-statement";
import { compareMonth, trackMonth, type TrackBill } from "@/lib/finance/month-tracker";
import { MonthEndCheck, MonthTrackerCard } from "@/components/finances/month-tracker";

export default async function CashPage({ searchParams }: { searchParams?: Promise<{ m?: string }> } = {}) {
  const user = await requireAuth();
  if (!canSeeBoardMoney(user.profile?.role)) redirect("/command-center");
  const db = await createClient();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const start = today.slice(0, 4) + "-01-01";
  const params = (await searchParams) ?? {};
  // A failed page fails the section, never turning a partial inventory into a total.
  const [bank, receipts, workspace, collectionInvoices, labor, yearBills] = await Promise.all([
    financialRows((from, to) => db.from("bank_transactions")
      .select("id, source, txn_date, amount, direction, description, category_key, match_status")
      .gte("txn_date", start).lte("txn_date", today)
      .order("id").range(from, to)),
    financialRows((from, to) => db.from("payments_received")
      .select("id, received_date, amount").gte("received_date", start).lte("received_date", today)
      .order("id").range(from, to)),
    getFinanceWorkspace(), getCollectionInvoices(),
    // Crew time priced at each person's rate on the day — the payroll the
    // month is running up before ADP drafts it.
    loadLaborLedger(db),
    // Every bill this year, for the month tracker (cost by bill date).
    financialRows((from, to) => db.from("invoices")
      .select("id, vendor_name, vendor_type, trade, description, invoice_date, amount, paid_amount, payment_status, payment_method, duplicate_of_id, projects(is_overhead), estimate_line_items:estimate_line_item_id(description)")
      .is("duplicate_of_id", null).gte("invoice_date", start).lte("invoice_date", today)
      .order("id").range(from, to)),
  ]);
  // Bills only matter after the last imported statement (inside it the bank
  // is the record), so load just that window.
  const through = bank
    .filter((r) => String(r.source).startsWith("eastern"))
    .reduce<string | null>((max, r) => (max === null || r.txn_date > max ? r.txn_date : max), null);
  const billsFrom = through ?? start;
  const bills = await financialRows((from, to) => db.from("invoices")
    .select("id, vendor_name, invoice_date, paid_date, amount, paid_amount, payment_status, payment_method, duplicate_of_id")
    .is("duplicate_of_id", null).eq("payment_status", "paid")
    .or(`paid_date.gte.${billsFrom},and(paid_date.is.null,invoice_date.gte.${billsFrom})`)
    .order("id").range(from, to));

  const statement = buildCashStatement({ bank, receipts, bills, today });

  const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null));
  const trackBills: TrackBill[] = yearBills.map((b) => ({
    ...b,
    is_overhead: one<{ is_overhead: boolean | null }>(b.projects)?.is_overhead ?? null,
    line_text: one<{ description: string | null }>(b.estimate_line_items)?.description ?? null,
  }));
  const shifts = labor.rows.map((r) => ({ date: r.date, open: r.open, paidMinutes: r.paidMinutes, wageCents: r.wageCents, rate: r.rate }));
  const currentKey = today.slice(0, 7);
  const monthKeys = Array.from({ length: Number(today.slice(5, 7)) }, (_, i) => `${today.slice(0, 4)}-${String(i + 1).padStart(2, "0")}`);
  const checkKey = monthKeys.includes(params.m ?? "") ? params.m! : currentKey;
  const trackInput = { bills: trackBills, shifts, receipts };
  const current = trackMonth(currentKey, trackInput);
  const checkTrack = checkKey === currentKey ? current : trackMonth(checkKey, trackInput);
  const bankMonth = statement.months.find((m) => m.key === checkKey && m.bankCount > 0) ?? null;
  const checkRows = compareMonth(checkTrack, bankMonth);

  const owedToUs = workspace.collections.filter(isActionableCollection)
    .reduce((sum, row) => sum + row.balance, 0) / 100;
  const vendorTotals = new Map<string, number>();
  for (const bill of workspace.bills.bills) {
    vendorTotals.set(bill.vendor, (vendorTotals.get(bill.vendor) ?? 0) + bill.amount);
  }
  const vendors = [...vendorTotals].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const debtors = new Map<string, number>();
  for (const row of workspace.collections) {
    if (!isActionableCollection(row)) continue;
    debtors.set(row.projectName, (debtors.get(row.projectName) ?? 0) + row.balance / 100);
  }
  const topDebtors = [...debtors].sort((a, b) => b[1] - a[1]).slice(0, 6);

  return <div className="flex min-w-0 flex-col gap-6">
    <CashFlowStatement
      statement={statement}
      tracker={<MonthTrackerCard track={current} through={statement.through} today={today} />}
      check={<MonthEndCheck rows={checkRows} month={checkKey} months={monthKeys} hasBank={!!bankMonth} />}
    />
    <div>
      <h2 className="text-base font-semibold">Coming up</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">What clients owe us and what we owe, as of today.</p>
    </div>
    <div className="-mt-3 grid gap-4 lg:grid-cols-2">
      <section className="@container min-w-0 rounded-xl border bg-card p-4 sm:p-5">
        <h3 className="text-sm font-semibold">Owed to us</h3>
        <div className="mt-1 text-[clamp(1.125rem,10cqi,1.875rem)] font-semibold tabular-nums text-sky-500 [overflow-wrap:anywhere]">{formatMoney(owedToUs)}</div>
        <p className="mt-1 text-xs text-muted-foreground">Open balances on invoices sent to clients</p>
        <div className="mt-3 space-y-2 text-xs">
          {topDebtors.map(([name, amount]) => <div key={name} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{name}</span><span className="shrink-0 tabular-nums">{formatMoney(amount)}</span>
          </div>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/finances?section=collections" className="text-sm font-medium text-amber-600 dark:text-amber-500">All collections →</Link>
          <CollectionPlanDialog plan={publishedCollectionPlan} invoiceProjects={collectionInvoices}
            triggerClassName="text-sm font-medium text-amber-600 dark:text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Collection plan →
          </CollectionPlanDialog>
        </div>
      </section>
      <section className="@container min-w-0 rounded-xl border bg-card p-4 sm:p-5">
        <h3 className="text-sm font-semibold">We owe</h3>
        <div className="mt-1 text-[clamp(1.125rem,10cqi,1.875rem)] font-semibold tabular-nums text-red-400 [overflow-wrap:anywhere]">{formatMoney(workspace.bills.total)}</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Open bills that have been reviewed
          {workspace.bills.reviewBalance > 0 && <> · {formatMoney(workspace.bills.reviewBalance)} more still in review</>}
        </p>
        <div className="mt-3 space-y-2 text-xs">
          {vendors.map(([vendor, amount]) => <div key={vendor} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{vendor}</span><span className="shrink-0 tabular-nums">{formatMoney(amount)}</span>
          </div>)}
        </div>
        <Link href="/finances?section=bills" className="mt-3 inline-block text-sm font-medium text-amber-600 dark:text-amber-500">All open bills →</Link>
      </section>
    </div>
  </div>;
}
