import type { ReactNode } from "react";
import Link from "next/link";
import type { CashStatement, StatementMonth } from "@/lib/finance/cash-statement";
import { OUTFLOW_GROUPS } from "@/lib/finance/cash-statement";

// Cents in, whole dollars out. Statement tables use accounting style:
// negatives in parentheses, so a column of numbers reads like a bank statement.
const whole = (cents: number) =>
  Math.round(cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const acct = (cents: number) => {
  if (Math.round(cents / 100) === 0) return "—";
  return cents < 0 ? `(${whole(-cents)})` : whole(cents);
};
const signed = (cents: number) => (cents < 0 ? `−${whole(-cents)}` : `+${whole(cents)}`);
const pct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.01 ? 1 : 0)}%`;

const dayLabel = (day: string, withYear = true) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
const monthShort = (key: string) =>
  new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" });
const monthLong = (key: string) =>
  new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });

function Kpi({ label, value, detail, tone = "" }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="@container min-w-0 rounded-xl border bg-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1.5 text-[clamp(1.125rem,11cqi,1.875rem)] font-semibold tabular-nums tracking-tight ${tone}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function MonthlyChart({ months }: { months: StatementMonth[] }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.cashIn, m.cashOut)));
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Month by month</h2>
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-500" />Cash in</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-500" />Cash out</span>
        </div>
      </div>
      <div className="mt-5 flex items-end gap-1 sm:gap-2" role="img"
        aria-label={months.map((m) => `${monthLong(m.key)}: in ${whole(m.cashIn)}, out ${whole(m.cashOut)}, net ${signed(m.net)}`).join("; ")}>
        {months.map((m) => (
          <div key={m.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className={`flex h-36 w-full items-end justify-center gap-[3px] ${m.provisional ? "opacity-45" : ""}`} aria-hidden="true">
              <div className="w-[38%] max-w-5 rounded-t-sm bg-emerald-500/85" style={{ height: `${Math.max(1.5, (m.cashIn / max) * 100)}%` }} />
              <div className="w-[38%] max-w-5 rounded-t-sm bg-amber-500/85" style={{ height: `${Math.max(1.5, (m.cashOut / max) * 100)}%` }} />
            </div>
            <span className="text-[10px] font-medium text-muted-foreground">{monthShort(m.key)}{m.provisional ? "*" : ""}</span>
            <span className={`hidden text-[10px] tabular-nums sm:block ${m.net < 0 ? "text-red-400" : "text-emerald-500"}`}>
              {m.net < 0 ? "−" : "+"}{Math.abs(Math.round(m.net / 100000))}k
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

const cell = "whitespace-nowrap px-2 py-2 text-right tabular-nums sm:px-3";
const label = "sticky left-0 z-10 w-[9rem] min-w-[9rem] bg-card px-3 py-2 text-left font-normal leading-snug shadow-[1px_0_0_var(--border)] sm:w-auto sm:min-w-[14rem] sm:shadow-none";

const PROV = "bg-amber-500/[0.07] italic";

function Row({ name, keys, prov, values, total, strong, tone, muted, indent }: {
  name: string; keys: string[]; prov: boolean[]; values: number[]; total: number; strong?: boolean; tone?: (n: number) => string; muted?: boolean; indent?: boolean;
}) {
  return (
    <tr className={strong ? "border-t font-semibold" : ""}>
      <th scope="row" className={`${label} ${indent ? "pl-6" : ""} ${muted ? "text-muted-foreground" : ""} ${strong ? "font-semibold" : ""}`}>{name}</th>
      {values.map((v, i) => (
        <td key={keys[i]} className={`${cell} ${prov[i] ? PROV : ""} ${muted ? "text-muted-foreground" : ""} ${tone ? tone(v) : ""}`}>{acct(v)}</td>
      ))}
      <td className={`${cell} border-l bg-muted/30 font-semibold ${tone ? tone(total) : ""}`}>{acct(total)}</td>
    </tr>
  );
}

function StatementTable({ statement }: { statement: CashStatement }) {
  const { months, totals } = statement;
  const groups = OUTFLOW_GROUPS.filter((g) => totals.byGroup[g.key] !== 0);
  const keys = months.map((m) => m.key);
  const prov = months.map((m) => !!m.provisional);
  const netTone = (n: number) => (n < 0 ? "text-red-400" : "text-emerald-600 dark:text-emerald-500");
  return (
    <section className="min-w-0 rounded-xl border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 p-4 sm:p-5">
        <div>
          <h2 className="text-sm font-semibold">Statement of cash flows</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Eastern Bank checking · rounded to the dollar</p>
        </div>
        <p className="text-xs text-muted-foreground sm:hidden">Swipe for every month →</p>
      </div>
      <div className="overflow-x-auto border-t">
        <table className="w-full text-[12px] sm:text-[13px]">
          <thead>
            <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
              <th scope="col" className={`${label} font-medium`}>2026</th>
              {months.map((m) => (
                <th key={m.key} scope="col" className={`${cell} font-medium ${m.provisional ? "bg-amber-500/[0.07] text-amber-700 dark:text-amber-400" : ""}`}>
                  {monthShort(m.key)}{m.provisional && <span className="block text-[9px] normal-case tracking-normal">so far*</span>}
                </th>
              ))}
              <th scope="col" className={`${cell} border-l font-medium`}>Year to date</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="rowgroup" className={`${label} pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-500`}>Cash in</th>
              <td colSpan={months.length} />
              <td className="border-l bg-muted/30" />
            </tr>
            <Row keys={keys} prov={prov} name="Client deposits" values={months.map((m) => m.deposits)} total={totals.deposits} indent />
            {totals.returned !== 0 && (
              <Row keys={keys} prov={prov} name="Returned checks" values={months.map((m) => -m.returned)} total={-totals.returned} indent muted />
            )}
            <Row keys={keys} prov={prov} name="Total cash in" values={months.map((m) => m.cashIn)} total={totals.cashIn} strong />
            <tr>
              <th scope="rowgroup" className={`${label} pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-500`}>Cash out</th>
              <td colSpan={months.length} />
              <td className="border-l bg-muted/30" />
            </tr>
            {groups.map((g) => (
              <Row key={g.key} keys={keys} prov={prov} name={g.label} values={months.map((m) => -m.byGroup[g.key])} total={-totals.byGroup[g.key]} indent />
            ))}
            <Row keys={keys} prov={prov} name="Total cash out" values={months.map((m) => -m.cashOut)} total={-totals.cashOut} strong />
            <tr className="border-t-2 border-foreground/20 text-[14px] font-semibold">
              <th scope="row" className={`${label} font-semibold`}>Net cash flow</th>
              {months.map((m) => (
                <td key={m.key} className={`${cell} ${m.provisional ? PROV : ""} ${netTone(m.net)}`}>{acct(m.net)}</td>
              ))}
              <td className={`${cell} border-l bg-muted/30 ${netTone(totals.net)}`}>{acct(totals.net)}</td>
            </tr>
            <tr className="text-muted-foreground">
              <th scope="row" className={`${label} text-muted-foreground`}>Running total since Jan 1</th>
              {months.map((m) => (
                <td key={m.key} className={`${cell} ${m.provisional ? PROV : ""}`}>{acct(m.cumulative)}</td>
              ))}
              <td className={`${cell} border-l bg-muted/30`} />
            </tr>
          </tbody>
        </table>
      </div>
      {months.some((m) => m.provisional) && (
        <p className="border-t px-4 py-3 text-[11px] leading-relaxed text-muted-foreground sm:px-5">
          * {months.filter((m) => m.provisional).map((m) => monthLong(m.key)).join(", ")} so far comes from the app until the bank statement
          is imported: client payments recorded, crew payroll from clock-ins (wages before payroll taxes), bills by bill date, and card
          purchases on the card line. It switches to the bank automatically once the statement is in.
        </p>
      )}
    </section>
  );
}

function WhereItWent({ statement }: { statement: CashStatement }) {
  const top = statement.outflows[0]?.amount || 1;
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Where the money went</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Year to date · {whole(statement.totals.cashOut)} out of checking</p>
      <ul className="mt-4 space-y-3">
        {statement.outflows.map((g) => (
          <li key={g.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{g.label}</span>
              <span className="shrink-0 tabular-nums">
                {whole(g.amount)} <span className="ml-1 text-xs text-muted-foreground">{pct(g.share)}</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-amber-500/80" style={{ width: `${Math.max(1, (g.amount / top) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {statement.card.count > 0 && (
        <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
          Capital One card purchases this year: {whole(statement.card.purchases)}
          {statement.card.through ? ` (statements through ${dayLabel(statement.card.through, false)})` : ""}. They are counted once, when the
          card is paid from checking under “Credit card payments.”
        </p>
      )}
    </section>
  );
}

function BooksVsBank({ statement }: { statement: CashStatement }) {
  const r = statement.reconciliation;
  const share = r.total ? r.matched / r.total : 0;
  return (
    <details className="group min-w-0 rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <h2 className="text-sm font-semibold">Books vs. bank</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {r.matched.toLocaleString()} of {r.total.toLocaleString()} bank transactions matched to a bill, payment or category
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${share * 100}%` }} />
          </div>
          <span className="text-sm font-semibold tabular-nums">{pct(share)}</span>
          <span className="text-xs text-muted-foreground group-open:hidden">Details ▾</span>
        </div>
      </summary>
      <div className="border-t p-4 sm:p-5">
        {r.open > 0 && (
          <p className="text-sm">
            {r.open.toLocaleString()} transactions ({whole(r.openAmount)}) still need a match. Unmatched items are already in the
            statement — matching them only fixes job costing and categories.
          </p>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[26rem] text-[13px]">
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="py-2 pr-3 text-left font-medium">Month</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Bank deposits</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Payments in the app</th>
                <th scope="col" className="py-2 pl-3 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody>
              {statement.months.filter((m) => !m.provisional).map((m) => {
                const diff = m.recordedReceipts - m.cashIn;
                const off = Math.abs(diff) >= 100_00;
                return (
                  <tr key={m.key} className="border-b last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">{monthLong(m.key)}</th>
                    <td className="px-3 py-2 text-right tabular-nums">{whole(m.cashIn)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{whole(m.recordedReceipts)}</td>
                    <td className={`py-2 pl-3 text-right tabular-nums ${off ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"}`}>
                      {off ? acct(diff) : "Ties"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          A difference usually means a deposit landed in a different month than the payment date logged in the app, or a deposit
          hasn’t been logged as a client payment yet. The statement always follows the bank.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-amber-600 dark:text-amber-500">
          <Link href="/finances?section=income">Review client payments →</Link>
          <Link href="/finances?section=activity">Review bills →</Link>
        </div>
      </div>
    </details>
  );
}

export function CashFlowStatement({ statement, tracker, check }: {
  statement: CashStatement;
  /** The running month, tracked from app records (crew clock + bills). */
  tracker?: ReactNode;
  /** Month-end check: app vs bank. */
  check?: ReactNode;
}) {
  const { totals, months, through } = statement;
  if (!through) {
    return (
      <section className="rounded-xl border border-amber-500/40 bg-card p-5">
        <h2 className="text-sm font-semibold">No bank statements imported for {statement.year}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Import the Eastern Bank checking statements to see cash in, cash out and net cash flow. Until then only app records are
          available, below.
        </p>
        {tracker && <div className="mt-4">{tracker}</div>}
      </section>
    );
  }
  // Average / best / weakest use full bank months; a month in progress would skew them.
  const banked = months.filter((m) => !m.provisional);
  const live = months.filter((m) => m.provisional);
  const liveNote = live.length ? ` · incl. ${live.map((m) => monthShort(m.key)).join(", ")} so far` : "";
  const avg = banked.length ? Math.round(banked.reduce((s2, m) => s2 + m.net, 0) / banked.length) : 0;
  const best = [...banked].sort((a, b) => b.net - a.net)[0];
  const worst = [...banked].sort((a, b) => a.net - b.net)[0];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Jan 1 – {dayLabel(live.length ? statement.today : through)} · {statement.bankCount.toLocaleString()} checking transactions
          {live.length > 0 && <> · {live.map((m) => monthLong(m.key)).join(", ")} so far from app records</>}
        </p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Bank statements through {dayLabel(through, false)}
        </span>
      </div>
      {statement.gaps.length > 0 && (
        <p role="status" className="rounded-xl border border-amber-500/40 p-3 text-sm">
          No bank statement imported for {statement.gaps.map(monthLong).join(", ")}. Those months show as zero until it is.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Cash in" value={whole(totals.cashIn)} tone="text-emerald-600 dark:text-emerald-500"
          detail={`${totals.returned ? `Client deposits, less ${whole(totals.returned)} in returned checks` : "Client deposits"}${liveNote}`} />
        <Kpi label="Cash out" value={whole(totals.cashOut)} tone="text-amber-600 dark:text-amber-500"
          detail={`Payroll, checks, ACH and card payoffs${liveNote}`} />
        <Kpi label="Net cash flow" value={signed(totals.net)} tone={totals.net < 0 ? "text-red-400" : "text-emerald-600 dark:text-emerald-500"}
          detail={`Year to date · ${pct(totals.cashIn ? totals.net / totals.cashIn : 0)} of cash in${liveNote}`} />
        <Kpi label={live.length ? "Average full month" : "Average month"} value={signed(avg)} tone={avg < 0 ? "text-red-400" : ""}
          detail={best && worst && best.key !== worst.key ? `Best ${monthShort(best.key)} ${signed(best.net)} · weakest ${monthShort(worst.key)} ${signed(worst.net)}` : "Net per month"} />
      </div>
      {tracker}
      <MonthlyChart months={months} />
      <StatementTable statement={statement} />
      {check}
      <div className="grid gap-4 lg:grid-cols-2">
        <WhereItWent statement={statement} />
        <BooksVsBank statement={statement} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Net cash flow is money in minus money out of checking. It is not profit (that depends on what was earned, not when it was
        deposited) and it does not include the opening bank balance.
      </p>
    </div>
  );
}
