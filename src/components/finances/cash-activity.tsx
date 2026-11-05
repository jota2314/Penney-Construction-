import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { summarizeCashFlow } from "@/lib/finance/overview-cash";
import { selectCashMonth } from "@/lib/finance/cash-month-selection";
import type { BankPeriod } from "@/lib/finance/bank-period";
import { BankPeriodPanel, BankPeriodUnavailable } from "@/components/finances/bank-period-panel";

type CashFlow = ReturnType<typeof summarizeCashFlow>;
type Records = CashFlow["yearToDate"];
const dateLabel = (day: string) => new Date(day + "T12:00:00Z").toLocaleDateString("en-US", {
  timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
});
const monthLabel = (key: string) => new Date(key + "-01T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });

function RecordedActivity({ records, period }: { records: Records; period: string }) {
  return <section className="min-w-0" aria-label={`Separate recorded entries for ${period}`}>
    <p className="text-xs leading-relaxed text-muted-foreground">{period} · App entries awaiting bank reconciliation. These subtotals use recorded receipt and payment dates; they do not establish money moving through the bank.</p>
    <dl className="mt-4 space-y-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><dt>Recorded receipt subtotal <span className="block text-xs text-muted-foreground">{records.receiptCount} entries, including recorded reversals</span></dt><dd className="font-medium tabular-nums">{formatMoney(records.received)}</dd></div>
      <div className="flex flex-wrap justify-between gap-2"><dt>Recorded bill payment subtotal <span className="block text-xs text-muted-foreground">{records.paidBillCount} included entries · includes card purchases</span></dt><dd className="font-medium tabular-nums">{records.paidBillCount === 0 && records.paymentIssueCount > 0 ? "Needs review" : formatMoney(records.paidBills)}</dd></div>
    </dl>
    <dl className="mt-4 space-y-2 border-t pt-3 text-xs">
      {[
        ["Marked check, ACH or other direct method", records.directPayments],
        ["Marked card purchase / credit", records.cardPurchases],
        ["Payment method needs confirmation", records.unclassifiedPayments],
      ].map(([label, amount]) => <div key={String(label)} className="flex items-start justify-between gap-4">
        <dt className="min-w-0">{label}</dt><dd className="shrink-0 tabular-nums">{formatMoney(Number(amount))}</dd>
      </div>)}
    </dl>
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Internal labor allocations are excluded. Bill entries can overlap payroll funding or card repayments. They are never added to the bank totals. Missing payment matches must be checked transaction by transaction.</p>
    {records.paymentIssueCount > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{records.paymentIssueCount} bill entries in this period have conflicting or invalid payment amounts and are excluded from the subtotal. Review their payment evidence before using a complete recorded total.</p>}
    {records.estimatedDateCount > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{records.estimatedDateCount} included bill entries use estimated payment dates. Bank clearance remains unverified.</p>}
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-amber-600 dark:text-amber-400">
      <Link href="/finances?section=income">Review receipts →</Link>
      <Link href="/finances?section=activity">Review bill records →</Link>
    </div>
  </section>;
}

export function CashActivity({ cash, today, month, bankPeriod, recordsUnavailable = false }: { cash: CashFlow; today: string; month?: string; bankPeriod?: BankPeriod; recordsUnavailable?: boolean }) {
  const year = today.slice(0, 4);
  const isYear = month === "ytd";
  const bank = cash.bank;
  const { selected, issue: selectionIssue } = isYear
    ? { selected: undefined, issue: null }
    : selectCashMonth(cash.months, month);
  const periodLabel = isYear ? `Year to date · ${year}` : selected ? `${monthLabel(selected.key)} ${year}` : "Choose a period";
  const records = recordsUnavailable ? undefined : isYear ? cash.yearToDate : selected?.records;
  const maxBank = Math.max(...cash.months.map(row => Math.max(row.bank.received, row.bank.spent)), 1);
  // A stale or mismatched prop must never put another period's totals beneath the selected label.
  const expectedStart = isYear ? `${year}-01-01` : selected ? `${selected.key}-01` : undefined;
  const expectedEnd = isYear ? today : selected
    ? new Date(Date.UTC(Number(year), Number(selected.key.slice(5, 7)), 0)).toISOString().slice(0, 10) : undefined;
  const matchingPeriod = bankPeriod && bankPeriod.start === expectedStart && bankPeriod.end === expectedEnd ? bankPeriod : undefined;

  return <>
    <div>
      <h2 className="text-lg font-semibold">Bank cash flow</h2>
      <p className="mt-1 text-sm text-muted-foreground">Money into and out of Eastern checking, by bank posting date.</p>
    </div>
    <nav aria-label="Cash flow period" className="flex min-w-0 flex-wrap gap-2">
      <Link href="/finances?section=cash&m=ytd" aria-current={isYear ? "page" : undefined}
        className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium ${isYear ? "border-amber-500 bg-amber-500/10" : "hover:bg-muted"}`}>Year to date · {year}</Link>
      {cash.months.map(row => <Link key={row.key} href={`/finances?section=cash&m=${row.key}`}
        aria-current={selected?.key === row.key ? "page" : undefined}
        className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium ${selected?.key === row.key ? "border-amber-500 bg-amber-500/10" : "hover:bg-muted"}`}>
        {monthLabel(row.key).slice(0, 3)} {year}
      </Link>)}
    </nav>
    {month === undefined && selected && <p className="text-xs text-muted-foreground">
      {selected.bank.count > 0 ? "Showing the latest month with imported bank activity" : "Showing the latest month with recorded entries; bank activity is unavailable"}: {periodLabel}.
    </p>}
    {selectionIssue && <p role="status" className="rounded-lg border border-amber-500/30 p-3 text-sm">
      {selectionIssue === "invalid" ? "That month is invalid. Choose a period above."
        : `The requested month (${month}) is not loaded in this ${year} view. Choose a period above.`}
    </p>}
    {(isYear || selected) && <div data-testid="selected-cash-month" data-month={selected?.key} data-period={isYear ? "ytd" : selected?.key}>
      <h3 className="mb-3 text-base font-semibold">{periodLabel}</h3>
      {matchingPeriod ? <BankPeriodPanel bank={matchingPeriod} periodLabel={periodLabel} /> : <BankPeriodUnavailable />}
    </div>}
    {!isYear && !selected && !selectionIssue && <BankPeriodUnavailable />}
    <p className="text-xs text-muted-foreground" role="status">
      {bank.through ? <>Latest imported bank transaction: {dateLabel(bank.through)}. {bank.through < today && "Activity after that date has not been imported."}</> : "No Eastern bank activity has been imported for this year."}
    </p>
    {records && <details className="rounded-xl border p-4 sm:p-5" data-testid="recorded-comparison">
      <summary className="cursor-pointer text-sm font-medium">Separate bill and receipt records · {periodLabel}</summary>
      <div className="mt-4"><RecordedActivity records={records} period={periodLabel} /></div>
    </details>}
    {recordsUnavailable && <p role="status" className="rounded-xl border border-amber-500/30 p-4 text-xs">Separate bill and receipt records could not be verified. Their subtotal is unavailable; the bank activity above is calculated independently.</p>}
    <details className="rounded-xl border p-4 sm:p-5" data-testid="bank-history">
      <summary className="cursor-pointer text-sm font-medium">Monthly bank activity · {year}</summary>
      <p className="mt-3 text-xs text-muted-foreground">Green: bank credits · Amber: bank debits. Empty months have no imported bank activity.</p>
      <div className="mt-5 flex h-40 items-end gap-1 sm:gap-3" aria-label="Monthly imported bank credits and debits">
        {cash.months.map(row => <Link key={row.key} href={`/finances?section=cash&m=${row.key}`}
          className={`flex min-w-0 flex-1 flex-col items-center justify-end gap-2 rounded-md px-0.5 py-2 ${selected?.key === row.key ? "bg-muted/60" : "hover:bg-muted/30"}`}
          aria-label={monthLabel(row.key) + ": " + (row.bank.count ? "bank credits " + formatMoney(row.bank.received) + ", bank debits " + formatMoney(row.bank.spent) : "no imported bank activity")}>
          <div className="flex w-full items-end justify-center gap-0.5 sm:gap-1" aria-hidden="true">
            <div className="w-2/5 max-w-6 rounded-t bg-emerald-500/80" style={{ height: row.bank.count ? Math.max(2, row.bank.received / maxBank * 105) : 2, opacity: row.bank.count ? 1 : 0.15 }} />
            <div className="w-2/5 max-w-6 rounded-t bg-amber-500/80" style={{ height: row.bank.count ? Math.max(2, row.bank.spent / maxBank * 105) : 2, opacity: row.bank.count ? 1 : 0.15 }} />
          </div>
          <span className="text-[10px] text-muted-foreground">{monthLabel(row.key).slice(0, 3)}</span>
        </Link>)}
      </div>
    </details>
    {!recordsUnavailable && isYear && cash.yearToDate.undatedPayments > 0 && <p role="status" className="rounded-xl border border-amber-500/30 p-4 text-xs">
      {cash.yearToDate.undatedPayments} paid bill entries in the loaded inventory have no usable payment or bill date ({formatMoney(cash.yearToDate.undatedPaymentAmount)}). They cannot be assigned to a cash period until their dates are verified.
    </p>}
  </>;
}
