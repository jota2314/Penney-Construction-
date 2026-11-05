import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CircleAlert, Receipt, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { financialRows } from "@/lib/crew/load-labor-ledger";
import { getFinanceWorkspace } from "@/lib/finance/workspace-data";
import { getCollectionPace } from "@/lib/finance/collection-pace";
import { healthFor, isActionableCollection, total } from "@/lib/finance/workspace-model";
import { buildExpenseView, type ExpenseRecord } from "@/lib/finance/expense-model";
import type { ReactNode } from "react";

const money = (cents: number) => (cents / 100).toLocaleString("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});
const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York",
});
const fulfilled = <T,>(result: PromiseSettledResult<T>): T | null =>
  result.status === "fulfilled" ? result.value : null;

function Metric({ label, value, detail, href, icon, tone = "" }: {
  label: string; value: string | null; detail: ReactNode; href: string; icon: ReactNode; tone?: string;
}) {
  return <Link href={href} className="group min-w-0 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5">
    <div className="flex items-center justify-between gap-3 text-muted-foreground">
      <span className="text-xs font-medium">{label}</span>{icon}
    </div>
    <p className={`mt-3 text-xl font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere] sm:text-2xl ${tone}`}>{value ?? "Unavailable"}</p>
    <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</div>
    <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium">View details <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span>
  </Link>;
}

function Panel({ title, detail, href, children }: { title: string; detail: string; href: string; children: ReactNode }) {
  return <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-5">
      <div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>
      <Link href={href} className="text-xs font-medium text-amber-700 underline-offset-4 hover:underline dark:text-amber-400">View all →</Link>
    </div>
    {children}
  </section>;
}

async function monthExpenses(start: string, end: string) {
  const db = await createClient();
  const rows = await financialRows((from, to) => db.from("invoices")
    .select("id,vendor_name,vendor_type,trade,description,invoice_number,amount,paid_amount,invoice_date,payment_status,payment_method,project_id,split_group_id,estimate_line_item_id,review_status,source,duplicate_of_id,is_capex,projects(name,project_number,is_overhead),estimate_line_items(description)").is("non_job_reason", null)
    .is("duplicate_of_id", null).gte("invoice_date", start).lte("invoice_date", end)
    .order("id").range(from, to));
  return buildExpenseView(rows as ExpenseRecord[], { start, end }).summary;
}

async function bankCoverage() {
  const db = await createClient();
  const { data, error } = await db.from("bank_transactions").select("txn_date")
    .like("source", "eastern%").order("txn_date", { ascending: false }).limit(1);
  if (error) throw new Error("Bank coverage unavailable");
  return data?.[0]?.txn_date as string | undefined;
}

export default async function FinanceOverview() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const monthStart = `${today.slice(0, 7)}-01`;
  // A failed source never becomes zero, and does not hide the independent sources.
  const [workspaceResult, paceResult, expenseResult, bankResult] = await Promise.allSettled([
    getFinanceWorkspace(), getCollectionPace(), monthExpenses(monthStart, today), bankCoverage(),
  ]);
  const data = fulfilled(workspaceResult), pace = fulfilled(paceResult), expenses = fulfilled(expenseResult);
  const bankThrough = fulfilled(bankResult);
  const open = data?.collections.filter(isActionableCollection) ?? [];
  const overdue = open.filter(row => row.daysLate > 0);
  const logged = data?.collections.filter(row => !row.issue && row.loggedPayment) ?? [];
  const flagged = data?.collections.filter(row => row.issue) ?? [];
  const followup = [...open].sort((a, b) => b.daysLate - a.daysLate || b.daysWaiting - a.daysWaiting || b.balance - a.balance).slice(0, 5);
  const watch = (data?.jobs ?? []).map(job => ({ job, health: healthFor(job) }))
    .filter(({ health }) => health.tone === "bad" || health.tone === "warn")
    .sort((a, b) => Number(b.health.tone === "bad") - Number(a.health.tone === "bad") || b.job.cost - a.job.cost);
  const bills = data?.bills.bills ?? [];
  const failed = [workspaceResult, paceResult, expenseResult, bankResult].some(result => result.status === "rejected");

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <p>As of {day(today)} · Penney records</p>
      <Link href="/finances?section=weekly" className="font-medium text-foreground underline underline-offset-4">Open Weekly Close →</Link>
    </div>
    {failed && <p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">Some finance sources could not load. Unavailable figures are shown below; refresh to retry.</p>}

    <section aria-labelledby="month-activity-heading" className="space-y-3">
      <div><h2 id="month-activity-heading" className="text-sm font-semibold">Month to date</h2><p className="mt-1 text-xs text-muted-foreground">{day(monthStart)} – {day(today)} · receipts and bill costs use different dates.</p></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Metric label="Recorded receipts" value={pace ? money(pace.month.collected) : null} href="/finances?section=income&range=month" icon={<ArrowDownLeft className="h-4 w-4" />} tone="text-emerald-700 dark:text-emerald-400"
          detail={pace ? <><span className="font-medium text-foreground">{money(pace.thisWeek.collected)} this week</span> · {pace.thisWeek.label}<br />By received date, including customer payments, other receipts and recorded reversals.</> : "Receipt totals could not load."} />
        <Metric label="Recorded expenses" value={expenses ? (expenses.invalidAmountCount ? "Needs review" : money(expenses.netCents)) : null} href="/finances?section=expenses&range=month" icon={<Receipt className="h-4 w-4" />}
          detail={expenses ? <>{expenses.invalidAmountCount ? "Bill amounts are incomplete." : <>{money(expenses.chargesCents)} charges − {money(expenses.creditsCents)} credits</>}<br />By bill date, including card purchases and unpaid bills. {expenses.reviewCount > 0 && `${expenses.reviewCount} allocations need review.`}</> : "Expense totals could not load."} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">These are recorded movements and purchases. Job profit, payroll costs and company overhead have their own detail views.</p>
    </section>

    <section aria-labelledby="balances-heading" className="space-y-3">
      <div><h2 id="balances-heading" className="text-sm font-semibold">Open balances today</h2><p className="mt-1 text-xs text-muted-foreground">All dates · amounts needing reconciliation are listed separately.</p></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Metric label="Customer invoices to follow up" value={data ? money(total(open, row => row.balance)) : null} href="/finances?section=collections" icon={<Wallet className="h-4 w-4" />}
          detail={data ? <>{open.length} issued invoices · {money(total(overdue, row => row.balance))} past due<br />{logged.length ? `${logged.length} possible receipt matches excluded pending review.` : "Recorded balances on issued invoices."}</> : "Open collection balances could not load."} />
        <Metric label="Reviewed vendor bills open" value={data ? money(Math.round(data.bills.total * 100)) : null} href="/finances?section=bills" icon={<ArrowUpRight className="h-4 w-4" />}
          detail={data ? <>{bills.length} bills · {bills.filter(bill => !bill.approved).length} awaiting payment approval<br />{data.bills.review.length ? `${money(Math.round(data.bills.reviewBalance * 100))} unresolved balances excluded.` : "Payment approval remains separate."}</> : "Open vendor balances could not load."} />
      </div>
    </section>

    {data && <section aria-labelledby="attention-heading" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
      <h2 id="attention-heading" className="flex items-center gap-2 text-sm font-semibold"><CircleAlert className="h-4 w-4 text-amber-600" />Needs attention</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Link href="/finances?section=collections" className="min-w-0 rounded-lg border bg-background/60 p-3 hover:bg-muted/40">
          <p className="text-sm font-medium">{flagged.length + logged.length} invoice checks</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{flagged.length} balance discrepancies · {logged.length} possible receipt matches. Review and apply receipts before closing invoices.</p>
        </Link>
        <Link href="/finances?section=bills" className="min-w-0 rounded-lg border bg-background/60 p-3 hover:bg-muted/40">
          <p className="text-sm font-medium">{data.bills.review.length} bill groups to reconcile</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Source, duplicate, allocation or payment questions. Unresolved balances are not confirmed amounts to pay.</p>
        </Link>
        <Link href="/finances?section=projects" className="min-w-0 rounded-lg border bg-background/60 p-3 hover:bg-muted/40">
          <p className="text-sm font-medium">{watch.length} projects to review</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Cost risks, overdue collections or evidence gaps. Open the job for its scope costs and crew hours.</p>
        </Link>
      </div>
      {data.auditError && <p className="mt-3 text-xs text-amber-800 dark:text-amber-300">{data.auditError}</p>}
    </section>}

    {data && <div className="grid items-start gap-4 xl:grid-cols-2">
      <Panel title="Collection follow-up" detail="Past due first, then longest waiting · up to 5 invoices" href="/finances?section=collections">
        <ul className="divide-y">{followup.map(row => <li key={row.id}>
          <Link href={`/finances?section=collections&collection=${row.projectId}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 hover:bg-muted/40 sm:px-5">
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{row.projectName}</p><p className="mt-1 break-words text-xs text-muted-foreground">Invoice #{row.number} · {row.title}</p></div>
            <div className="text-right"><p className="text-sm font-semibold tabular-nums">{money(row.balance)}</p><p className={`mt-1 text-xs ${row.daysLate > 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>{row.daysLate > 0 ? `${row.daysLate} days past due` : row.due ? `Due ${day(row.due)}` : "Due date missing"}</p></div>
          </Link>
        </li>)}</ul>
        {!followup.length && <p className="p-5 text-sm text-muted-foreground">No invoices in the follow-up list. Check reconciliation items before concluding everything is settled.</p>}
      </Panel>
      <Panel title="Bills coming due" detail="Reviewed open bills · oldest due date first · up to 5 bills" href="/finances?section=bills">
        <ul className="divide-y">{bills.slice(0, 5).map(bill => <li key={bill.id}>
          <Link href={`/spent/${bill.id}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 hover:bg-muted/40 sm:px-5">
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{bill.vendor}</p><p className="mt-1 break-words text-xs text-muted-foreground">{bill.projects.join(" · ")}</p><p className="mt-1 text-xs text-muted-foreground">{bill.approved ? "Approved for payment" : "Awaiting payment approval"}</p></div>
            <div className="text-right"><p className="text-sm font-semibold tabular-nums">{money(Math.round(bill.amount * 100))}</p><p className="mt-1 text-xs text-muted-foreground">{bill.dueDate ? `Due ${day(bill.dueDate)}` : "Due date missing"}</p></div>
          </Link>
        </li>)}</ul>
        {!bills.length && <p className="p-5 text-sm text-muted-foreground">No reviewed open bills. Unresolved bills remain in the review queue.</p>}
      </Panel>
    </div>}

    {data && watch.length > 0 && <Panel title="Project watch list" detail="Recorded cost risks first · up to 5 jobs" href="/finances?section=projects">
      <ul className="divide-y">{watch.slice(0, 5).map(({ job, health }) => <li key={job.id}>
        <Link href={`/projects/${job.id}?tab=finances`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 hover:bg-muted/40 sm:px-5">
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{job.name}</p><p className="mt-1 text-xs text-muted-foreground">{job.number} · {job.warnings[0] ?? health.label}</p></div>
          <div className="text-right"><p className={`text-xs font-medium ${health.tone === "bad" ? "text-red-700 dark:text-red-400" : "text-amber-800 dark:text-amber-400"}`}>{health.label}</p><p className="mt-1 text-xs text-muted-foreground">{money(job.cost)} recorded cost{job.budget !== null ? ` / ${money(job.budget)} budget` : " · budget missing"}</p></div>
        </Link>
      </li>)}</ul>
    </Panel>}

    <Link href="/finances?section=cash" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4 text-sm hover:bg-muted/40">
      <div><p className="font-medium">Bank activity &amp; cash flow</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{bankResult.status === "rejected" ? "Bank coverage could not load." : bankThrough ? `Latest imported Eastern transaction: ${day(bankThrough)}.` : "No Eastern transactions imported."} Import dates do not confirm statement completeness or today’s bank balance.</p></div>
      <span className="shrink-0 text-xs font-medium">Review cash flow →</span>
    </Link>
  </div>;
}
