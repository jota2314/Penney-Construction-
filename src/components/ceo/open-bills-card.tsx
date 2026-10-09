import Link from "next/link";
import { ArrowUpRight, Receipt } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { OpenBillsSummary } from "@/lib/finance/open-bills";

export function OpenBillsCard({ summary }: { summary: OpenBillsSummary }) {
  return <section id="open-bills" className="min-w-0 overflow-hidden rounded-xl border bg-card">
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <Receipt className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <h3 className="text-sm font-semibold">Recorded open vendor bills</h3>
      <span className="text-xs text-muted-foreground">{summary.bills.length} bill{summary.bills.length === 1 ? "" : "s"}</span>
      <span className="ml-auto text-sm font-bold tabular-nums">{formatMoney(summary.total)}</span>
    </div>
    <p className="border-b px-4 py-3 text-xs leading-relaxed text-muted-foreground">Remaining balances on reviewed Penney records. Split allocations count as one bill. These are recorded balances, not a bank-verified payable total. Approval status is shown separately.</p>
    <div className="max-h-96 divide-y overflow-y-auto">
      {summary.bills.map(bill => <Link key={bill.id} href={`/spent/${bill.id}`} className="block px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <div className="flex flex-wrap items-start justify-between gap-2 text-sm"><span className="font-medium">{bill.vendor}</span><span className="font-semibold tabular-nums">{formatMoney(bill.amount)}</span></div>
        <p className="mt-1 text-xs text-muted-foreground">{bill.projects.join(" · ")}{bill.reference ? ` · #${bill.reference}` : ""}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className={bill.approved ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>{bill.approved ? "Approved for payment" : "Awaiting payment approval"}</span>
          <span className="text-muted-foreground">{bill.dueDate ? `Due ${bill.dueDate}` : "No due date recorded"}</span>
          {bill.overdueDays !== null && bill.overdueDays > 0 && <span className="text-red-600 dark:text-red-400">{bill.overdueDays} days past due</span>}
          <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">View bill <ArrowUpRight className="h-3 w-3" /></span>
        </div>
      </Link>)}
      {!summary.bills.length && <p className="px-4 py-4 text-sm text-muted-foreground">No reviewed open vendor bills. Check the unresolved records below before concluding nothing is owed.</p>}
    </div>
    {summary.review.length > 0 && <details className="group border-t bg-amber-500/5">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">{summary.review.length} bill records need reconciliation · excluded from open bills</summary>
      <div className="border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">{formatMoney(summary.reviewBalance)} in unresolved positive balances, plus any zero-balance status conflicts. These records may include duplicate entries, internal labor, incoming checks, or conflicting payment information. They are not confirmed amounts to pay.</div>
      <div className="max-h-96 divide-y overflow-y-auto">{summary.review.map(bill => <Link key={bill.id} href={`/spent/${bill.id}`} className="block px-4 py-3 text-xs hover:bg-muted/40">
        <div className="flex flex-wrap justify-between gap-2 font-medium"><span>{bill.vendor}</span><span className="tabular-nums">{bill.amount > 0 ? `${formatMoney(bill.amount)} unresolved` : "Balance/status conflict"}</span></div>
        <p className="mt-1 text-muted-foreground">{bill.projects.join(" · ")}</p>
        <p className="mt-2 leading-relaxed text-amber-700 dark:text-amber-400">{bill.reasons.join(" · ")}</p>
        <span className="mt-2 inline-flex items-center gap-1 underline underline-offset-2">Inspect record <ArrowUpRight className="h-3 w-3" /></span>
      </Link>)}</div>
    </details>}
  </section>;
}
