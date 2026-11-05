import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { BankPeriod } from "@/lib/finance/bank-period";

const fmt = (cents: number | null | undefined) => cents == null ? "Unavailable" : formatMoney(cents / 100, { cents: "always" });
const day = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const categoryLabel: Record<string, string> = {
  payroll: "Payroll funding", cardRepayments: "Card repayment", checks: "Check", other: "Other withdrawal", credit: "Deposit / credit",
};

export function BankPeriodUnavailable() {
  return <section role="status" className="rounded-xl border border-amber-500/30 bg-card p-4">
    <h2 className="text-sm font-semibold">Eastern bank activity unavailable</h2>
    <p className="mt-2 text-xs text-muted-foreground">The bank records could not load completely. Refresh to retry. Bill records remain separate; a missing bank total is not zero.</p>
  </section>;
}

/** Cash movements and their saved links only; no bill costs are added to cash. */
export function BankPeriodPanel({ bank, periodLabel, cashHref }: {
  bank: BankPeriod; periodLabel: string; cashHref?: string;
}) {
  const totals = bank.totals;
  return <section className="min-w-0 rounded-xl border border-sky-500/25 bg-card p-4 sm:p-5" data-testid="bank-period-panel">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="text-sm font-semibold">Eastern bank activity</h2><p className="mt-1 text-xs text-muted-foreground">{periodLabel} · {day(bank.start)}–{day(bank.end)}</p></div>
      <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">{bank.status === "empty" ? "No imported activity" : bank.status === "invalid" ? "Bank records need review" : "Statement verification needed"}</span>
    </div>
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Imported Eastern checking activity for the selected period, using bank posting dates. Expense category and job filters do not change these account totals.</p>
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {[
        { label: "Money out · imported", value: totals?.debitsCents, note: `${bank.debitCount} withdrawals`, color: "text-amber-600 dark:text-amber-400" },
        { label: "Money in · imported", value: totals?.creditsCents, note: `${bank.creditCount} deposits / credits`, color: "text-emerald-700 dark:text-emerald-400" },
        { label: "Net bank movement", value: totals?.netCents, note: "Excludes opening balance; not profit", color: "" },
      ].map(card => <div key={card.label} className="@container min-w-0 rounded-lg bg-muted/40 p-3">
        <p className="text-[11px] font-medium text-muted-foreground">{card.label}</p>
        <p className={`mt-1 break-words text-[clamp(1rem,10cqi,1.6rem)] font-semibold tabular-nums ${card.color}`}>{fmt(card.value)}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{card.note}</p>
      </div>)}
    </div>
    {bank.status === "empty" ? <p className="mt-3 text-xs text-muted-foreground">There are no imported Eastern transactions in this period. This does not establish zero spending or a reconciled month.</p> : <>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        {[
          ["Payroll funding", totals?.payrollCents], ["Card repayments", totals?.cardRepaymentsCents],
          ["Checks", totals?.checksCents], ["Other withdrawals", totals?.otherCents],
        ].map(([label, value]) => <div key={String(label)} className="flex justify-between gap-3"><dt>{label}</dt><dd className="shrink-0 tabular-nums">{fmt(typeof value === "number" ? value : null)}</dd></div>)}
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">These four categories add to money out. Card purchases, bill totals and payroll allocations are not added again. Card repayments settle the card account; they are not office overhead.</p>
      {bank.firstDate && bank.through && <p className="mt-2 text-[11px] text-muted-foreground">{bank.count} imported entries · transaction dates {day(bank.firstDate)}–{day(bank.through)}. Dates and filenames alone do not establish a complete statement.</p>}
    </>}
    {bank.issues.length > 0 && <div role="status" className="mt-3 rounded-lg border border-amber-500/30 p-3 text-xs"><p className="font-medium">Bank total needs verification</p><ul className="mt-2 list-disc space-y-1 pl-4">{bank.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></div>}
    <div className="mt-4 border-t pt-3 text-xs">
      <p className="font-medium">Statement difference: not verified</p>
      <p className="mt-1 leading-relaxed text-muted-foreground">Confirm the original statement: opening balance + money in − money out = closing balance. Then check the bill, receipt, payroll and transfer evidence for each movement. Until both checks are complete, this period remains unreconciled.</p>
      {bank.count > 0 && <p className="mt-2 text-muted-foreground">{bank.linkedRowCount} entries have saved record links; {bank.noLinkRowCount} have none. Payroll and transfers may need evidence other than a bill. Saved links alone do not confirm statement reconciliation.</p>}
      {bank.matchingIssueCount > 0 && <p className="mt-2 text-amber-700 dark:text-amber-400">{bank.matchingIssueCount} entries have record-link amounts that need review. These issues do not change the bank cash totals.</p>}
      {bank.statementFiles.length > 0 && <details className="mt-3"><summary className="cursor-pointer font-medium">Imported statement references</summary><ul className="mt-2 space-y-1 break-all text-muted-foreground">{bank.statementFiles.map(file => <li key={file}>{file}</li>)}</ul></details>}
    </div>
    {bank.rows.length > 0 && <details className="mt-4 border-t pt-3">
      <summary className="cursor-pointer text-sm font-medium">Inspect all {bank.rows.length} bank entries</summary>
      <div className="mt-3 max-h-[36rem] overflow-y-auto rounded-lg border">
        <div className="divide-y">{bank.rows.map((row, index) => <details key={`${row.id || "invalid"}-${index}`} className="group">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3 hover:bg-muted/40">
            <div className="min-w-0"><p className="break-words text-xs font-medium">{row.description || "Bank transaction"}</p><p className="mt-1 text-[11px] text-muted-foreground">{row.txn_date} · {row.category ? categoryLabel[row.category] : "Needs review"}{row.matches.length ? ` · ${row.matches.length} saved links` : " · No saved record link"}</p></div>
            <span className={`shrink-0 text-right text-xs font-semibold tabular-nums ${row.direction === "credit" ? "text-emerald-700 dark:text-emerald-400" : ""}`}><span className="block text-[10px] font-normal text-muted-foreground">{row.direction === "debit" ? "Money out" : row.direction === "credit" ? "Money in" : "Direction unknown"}</span>{fmt(row.amountCents)}</span>
          </summary>
          <div className="space-y-2 border-t bg-muted/20 p-3 text-[11px] text-muted-foreground">
            {row.statement_file && <p className="break-all">Statement reference: {row.statement_file}</p>}
            {row.check_number && <p>Check #{row.check_number}</p>}
            {row.match_note && <p className="break-words">Saved note: {row.match_note}</p>}
            {row.matches.length > 0 && <><p>Valid saved link amounts: {fmt(row.linkedCents)} · Remaining unlinked: {fmt(row.remainingCents)}</p><ul className="space-y-1">{row.matches.map((match, i) => <li key={`${match.id}-${i}`}>{match.invoice_id ? <Link href={`/spent/${match.invoice_id}`} className="font-medium underline underline-offset-2">Open linked bill</Link> : <span className="break-all">{match.payment_id ? `Receipt record ${match.payment_id}` : "Record target missing"}</span>} · {fmt(match.amountCents)}{match.confidence ? ` · ${match.confidence.replaceAll("_", " ")}` : ""}</li>)}</ul></>}
            {[...row.issues, ...row.matchingIssues].map((issue, i) => <p key={i} className="text-amber-700 dark:text-amber-400">{issue.message}</p>)}
          </div>
        </details>)}</div>
      </div>
    </details>}
    {cashHref && <Link href={cashHref} className="mt-4 inline-block text-xs font-medium underline underline-offset-2">Open this month in Cash flow →</Link>}
  </section>;
}
