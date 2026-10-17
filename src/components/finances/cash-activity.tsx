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

function RecordedActivity({ records, title, period }: { records: Records; title: string; period: string }) {
  return <section className="min-w-0 rounded-xl border border-amber-500/30 bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <span className="text-xs text-amber-500">Awaiting bank reconciliation</span>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">{period}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <MoneyCard label="Receipts recorded" amount={records.received} tone="text-emerald-500"
        detail={records.receiptCount + " receipt entries, including recorded reversals"} />
      <MoneyCard label="Bill payments recorded" amount={records.paidBills} tone="text-amber-500"
        detail={records.paidBillCount + " bill entries · includes card purchases"} />
    </div>
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
      These records are already in Penney. Card purchases are separate because bank cash leaves when the card is paid.
      Payroll, card repayments and payment clearance still need bank confirmation; these entries do not establish a current bank balance or complete net cash flow.
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
      <h2 className="text-lg font-semibold">Cash flow · {year}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {bank.through ? <>Eastern Bank activity imported through <strong className="text-foreground">{dateLabel(bank.through)}</strong>.</>
          : "No Eastern Bank activity has been imported for this year."}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Current bank balance is not available from these records. Recorded receipts and bills are shown separately below.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="bank-cash-summary">
      <MoneyCard label="Money into Eastern" amount={bank.count ? bank.received : null} tone="text-emerald-500" detail="Credits in imported bank activity" />
      <MoneyCard label="Money out of Eastern" amount={bank.count ? bank.spent : null} tone="text-amber-500" detail="Includes payroll, card repayments and returned deposits" />
      <MoneyCard label="Net bank movement" amount={bank.count ? bank.net : null} tone={bank.net < 0 ? "text-red-400" : "text-foreground"}
        detail={bank.through ? "Imported activity through " + dateLabel(bank.through) : "Bank activity required"} />
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">
      Every imported bank movement is counted once. Bills, card purchases and payroll allocations are not added again.
      Net movement excludes the opening balance and is not profit or available cash.
      {bank.firstDate && <> Imported transaction dates: {dateLabel(bank.firstDate)}–{dateLabel(bank.through!)}. Import dates alone do not certify complete statement coverage.</>}
    </p>
    {showLater && <RecordedActivity records={cash.later.records}
      title={bank.through ? "Recorded since the last bank import" : "Recorded activity"}
      period={dateLabel(cash.later.from) + "–" + dateLabel(today)} />}
    {!showLater && (!bank.through || bank.through < today) && <p className="rounded-xl border border-amber-500/30 p-4 text-sm text-muted-foreground">
      No later receipts or paid bills are recorded. Bank activity after {bank.through ? dateLabel(bank.through) : "the start of the year"} remains unverified.
    </p>}
    {cash.later.records.undatedPayments > 0 && <p role="status" className="rounded-xl border border-amber-500/30 p-4 text-xs">
      {cash.later.records.undatedPayments} paid bill entries have no usable payment or bill date ({formatMoney(cash.later.records.undatedPaymentAmount)}).
      They cannot be assigned to a cash period until their dates are verified.
    </p>}
    {cash.later.records.unresolvedPaymentAmounts > 0 && <p role="status" className="rounded-xl border border-amber-500/30 p-4 text-xs">
      {cash.later.records.unresolvedPaymentAmounts} partially paid bill entries have no valid payment amount. They need review and are excluded from the recorded payment totals.
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
  </>;
}
