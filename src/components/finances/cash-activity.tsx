import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { summarizeCashFlow } from "@/lib/finance/overview-cash";

type CashFlow = ReturnType<typeof summarizeCashFlow>;
type Records = CashFlow["later"]["records"];
const dateLabel = (day: string) => new Date(day + "T12:00:00Z").toLocaleDateString("en-US", {
  timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
});
const monthLabel = (key: string) => new Date(key + "-01T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });
const hasRecords = (records: Records) => records.receiptCount > 0 || records.paidBillCount > 0;

function MoneyCard({ label, amount, detail, tone = "text-foreground" }: {
  label: string; amount: number | null; detail: string; tone?: string;
}) {
  return <div className="@container min-w-0 rounded-xl border bg-card p-4">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={"mt-1 text-[clamp(1rem,10cqi,1.875rem)] font-bold tabular-nums [overflow-wrap:anywhere] " + tone}>
      {amount === null ? "Unavailable" : formatMoney(amount)}
    </div>
    <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
  </div>;
}

function RecordedActivity({ records, title, period, payroll }: { records: Records; title: string; period: string; payroll?: CashFlow["payroll"] }) {
  return <section className="min-w-0 rounded-xl border border-amber-500/30 bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <span className="text-xs text-amber-500">Awaiting bank reconciliation</span>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">{period}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <MoneyCard label="Money received · recorded" amount={records.received} tone="text-emerald-500"
        detail={records.receiptCount + " receipt entries, including recorded reversals"} />
      <MoneyCard label="Paid bill records" amount={records.paidBills} tone="text-amber-500"
        detail={records.paidBillCount + " bill entries · includes card purchases" + (payroll ? "; payroll detail below" : "")} />
    </div>
    {payroll && <div className="mt-4 rounded-lg border p-3 text-sm" data-testid="payroll-reconciliation">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">Payroll awaiting bill matching</span>
        <strong className="tabular-nums text-amber-500">{payroll.bankPayrollThrough ? formatMoney(payroll.additionalBankPayroll) : "Unavailable"}</strong>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {payroll.bankPayrollThrough ? <>Bank payroll with no ADP bill entries in the same months. Dates and overlap must be checked before adding it to the bill subtotal. Payroll bank records run through {dateLabel(payroll.bankPayrollThrough)}; {formatMoney(payroll.recordedADPpayroll)} of ADP payroll is already in the bills.</>
          : "Payroll bank records are not available. The bill subtotal does not establish complete payroll spending."}
      </p>
      {payroll.uncertainOverlapMonths.length > 0 && <p className="mt-2 text-xs text-amber-500">
        Payroll overlap needs review for {payroll.uncertainOverlapMonths.map(monthLabel).join(", ")}. No extra payroll from those months has been added.
      </p>}
    </div>}
    <dl className="mt-4 space-y-2 text-xs sm:text-sm">
      {[
        ["Checks, ACH and other direct payments", records.directPayments],
        ["Card purchases / credits", records.cardPurchases],
        ["Payment method needs confirmation", records.unclassifiedPayments],
      ].map(([label, amount]) => <div key={String(label)} className="flex items-start justify-between gap-4">
        <dt className="min-w-0">{label}</dt><dd className="shrink-0 tabular-nums">{formatMoney(Number(amount))}</dd>
      </div>)}
    </dl>
    <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
      Includes all recorded receipts and paid bills in this period. Card purchases are included in the bill subtotal; their repayments are not added again.
      Full cash paid out and net cash flow remain unreconciled. Later payroll, payment methods and bank clearance still need confirmation.
    </p>
    {records.estimatedDateCount > 0 && <p className="mt-2 text-xs text-muted-foreground">
      {records.estimatedDateCount} bill entries have known estimated payment dates. Other stored payment dates may also come from bill entry; bank clearance is unverified.
    </p>}
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-amber-500">
      <Link href="/finances?section=income">Review receipts →</Link>
      <Link href="/finances?section=activity">Review bill records →</Link>
    </div>
  </section>;
}

export function CashActivity({ cash, today, month }: { cash: CashFlow; today: string; month?: string }) {
  const year = today.slice(0, 4);
  const bank = cash.bank;
  const available = cash.months.filter(row => row.bank.count > 0 || hasRecords(row.records));
  const selected = available.find(row => row.key === month)
    ?? [...available].reverse().find(row => row.bank.count > 0)
    ?? available.at(-1);
  const showLater = hasRecords(cash.later.records);
  const maxBank = Math.max(...cash.months.map(row => Math.max(row.bank.received, row.bank.spent)), 1);

  return <>
    <div>
      <h2 className="text-lg font-semibold">Recorded money · {year}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Year to date through {dateLabel(today)}, including {monthLabel(today.slice(0, 7))} records.</p>
    </div>
    <div data-testid="recorded-ytd-summary">
      <RecordedActivity records={cash.yearToDate} title="Year to date" period={dateLabel(year + "-01-01") + "–" + dateLabel(today)} payroll={cash.payroll} />
    </div>
    {showLater && bank.through && <details className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">Records after {dateLabel(bank.through)}</summary>
      <div className="mt-4"><RecordedActivity records={cash.later.records}
        title="Included in the year-to-date records above"
        period={dateLabel(cash.later.from) + "–" + dateLabel(today)} /></div>
    </details>}
    {cash.later.records.undatedPayments > 0 && <p role="status" className="rounded-xl border border-amber-500/30 p-4 text-xs">
      {cash.later.records.undatedPayments} paid bill entries have no usable payment or bill date ({formatMoney(cash.later.records.undatedPaymentAmount)}).
      They cannot be assigned to a cash period until their dates are verified.
    </p>}
    {cash.later.records.unresolvedPaymentAmounts > 0 && <p role="status" className="rounded-xl border border-amber-500/30 p-4 text-xs">
      {cash.later.records.unresolvedPaymentAmounts} partially paid bill entries have no valid payment amount. They need review and are excluded from the recorded payment totals.
    </p>}
    <details className="rounded-xl border p-4 sm:p-5" open={Boolean(month)} data-testid="bank-reconciliation">
      <summary className="cursor-pointer text-sm font-medium">Bank reconciliation{bank.through ? " · through " + dateLabel(bank.through) : " · no imports"}</summary>
      <div className="mt-4 flex flex-col gap-4">
    <p className="text-xs text-muted-foreground">These bank totals cover the imported dates only. They are not current year-to-date business totals or your current bank balance.</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="bank-cash-summary">
      <MoneyCard label="Imported bank credits" amount={bank.count ? bank.received : null} tone="text-emerald-500" detail="Credits in imported bank activity" />
      <MoneyCard label="Imported bank debits" amount={bank.count ? bank.spent : null} tone="text-amber-500" detail="Includes payroll, card repayments and returned deposits" />
      <MoneyCard label="Net bank movement" amount={bank.count ? bank.net : null} tone={bank.net < 0 ? "text-red-400" : "text-foreground"}
        detail={bank.through ? "Imported activity through " + dateLabel(bank.through) : "Bank activity required"} />
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">
      Every imported bank movement is counted once. Bills, card purchases and payroll allocations are not added again.
      Net movement excludes the opening balance and is not profit or available cash.
      {bank.firstDate && <> Imported transaction dates: {dateLabel(bank.firstDate)}–{dateLabel(bank.through!)}. Import dates alone do not certify complete statement coverage.</>}
    </p>
    {!showLater && (!bank.through || bank.through < today) && <p className="rounded-xl border border-amber-500/30 p-4 text-sm text-muted-foreground">
      No later receipts or paid bills are recorded. Bank activity after {bank.through ? dateLabel(bank.through) : "the start of the year"} remains unverified.
    </p>}
    {available.length > 0 && <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Monthly bank activity</h2>
      <p className="mt-1 text-xs text-muted-foreground">Green: bank credits · Amber: bank debits. Months with only bill and receipt records have no bank bars.</p>
      <div className="mt-5 flex h-40 items-end gap-1 sm:gap-3" aria-label="Monthly imported bank credits and debits">
        {cash.months.map(row => <Link key={row.key} href={"/finances?section=cash&m=" + row.key}
          className={"flex min-w-0 flex-1 flex-col items-center justify-end gap-2 rounded-md px-0.5 py-2 " + (selected?.key === row.key ? "bg-muted/60" : "hover:bg-muted/30")}
          aria-label={monthLabel(row.key) + ": " + (row.bank.count ? "bank credits " + formatMoney(row.bank.received) + ", bank debits " + formatMoney(row.bank.spent) : hasRecords(row.records) ? "recorded activity; no bank import" : "no imported activity")}>
          <div className="flex w-full items-end justify-center gap-0.5 sm:gap-1" aria-hidden="true">
            <div className="w-2/5 max-w-6 rounded-t bg-emerald-500/80" style={{ height: row.bank.count ? Math.max(2, row.bank.received / maxBank * 105) : 2, opacity: row.bank.count ? 1 : 0.15 }} />
            <div className="w-2/5 max-w-6 rounded-t bg-amber-500/80" style={{ height: row.bank.count ? Math.max(2, row.bank.spent / maxBank * 105) : 2, opacity: row.bank.count ? 1 : 0.15 }} />
          </div>
          <span className="text-[10px] text-muted-foreground">{monthLabel(row.key).slice(0, 3)}</span>
        </Link>)}
      </div>
      {selected && <div className="mt-5 border-t pt-4">
        <h3 className="text-sm font-semibold">{monthLabel(selected.key)} {year}</h3>
        {selected.bank.count > 0 ? <>
          <p className="mt-1 text-xs text-muted-foreground">{selected.bank.count} imported bank entries · latest transaction {dateLabel(selected.bank.through!)}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <MoneyCard label="Bank credits" amount={selected.bank.received} detail="Money into the account" tone="text-emerald-500" />
            <MoneyCard label="Bank debits" amount={selected.bank.spent} detail="Money out of the account" tone="text-amber-500" />
            <MoneyCard label="Net movement" amount={selected.bank.net} detail="Opening balance excluded" />
          </div>
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            {[["Payroll — wages, taxes and fees", selected.bank.payroll], ["Card repayments", selected.bank.cardPayoff], ["Checks", selected.bank.checks], ["Other bank debits", selected.bank.other]].map(([label, amount]) =>
              <div key={String(label)} className="flex justify-between gap-3"><dt>{label}</dt><dd className="shrink-0 tabular-nums">{formatMoney(Number(amount))}</dd></div>)}
          </dl>
          <details className="mt-4 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Separate bill and receipt records for {monthLabel(selected.key)}</summary>
            <p className="mt-2">{formatMoney(selected.records.received)} in recorded receipts; {formatMoney(selected.records.paidBills)} in recorded bill payments, including {formatMoney(selected.records.cardPurchases)} of card purchases/credits and {formatMoney(selected.records.unclassifiedPayments)} awaiting payment-method confirmation. These are not added to bank movements.</p>
          </details>
        </> : <p className="mt-2 text-sm text-muted-foreground">
          {formatMoney(selected.records.received)} in receipts and {formatMoney(selected.records.paidBills)} in bill payments are recorded for this month. No bank activity has been imported for it, so a bank cash-flow total is unavailable.
        </p>}
      </div>}
    </section>}
      </div>
    </details>
  </>;
}
