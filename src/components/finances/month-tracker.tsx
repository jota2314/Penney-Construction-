import Link from "next/link";
import { TRACK_LINES, type CompareRow, type MonthTrack } from "@/lib/finance/month-tracker";

const whole = (cents: number) =>
  Math.round(cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const acct = (cents: number) => (Math.round(cents / 100) === 0 ? "—" : cents < 0 ? `(${whole(-cents)})` : whole(cents));
const monthLong = (key: string) =>
  new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });
const monthShort = (key: string) =>
  new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" });

/** The running month, from app records: crew clock-ins and every bill entered so far. */
export function MonthTrackerCard({ track, through, today }: { track: MonthTrack; through: string | null; today: string }) {
  const lines = TRACK_LINES.filter((l) => track.lines[l.key] !== 0);
  const top = Math.max(1, ...lines.map((l) => track.lines[l.key]));
  const day = Number(today.slice(8, 10));
  return (
    <section className="min-w-0 rounded-xl border border-amber-500/40 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-500">Tracking now</p>
          <h2 className="mt-0.5 text-base font-semibold">{monthLong(track.key)} so far · day {day}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            From the app: crew clock-ins and every bill entered.{" "}
            {through && through < `${track.key}-01` ? "The bank statement for this month isn’t in yet — this is the running tally to check it against." : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Costs so far</p>
          <p className="text-2xl font-semibold tabular-nums">{whole(track.total)}</p>
          <p className="text-xs text-emerald-600 dark:text-emerald-500 tabular-nums">{whole(track.receipts)} in from clients</p>
        </div>
      </div>
      {lines.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nothing recorded yet this month.</p>
      ) : (
        <ul className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {lines.map((l) => (
            <li key={l.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{l.label}</span>
                <span className="shrink-0 tabular-nums">{whole(track.lines[l.key])}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-amber-500/80" style={{ width: `${Math.max(1, (track.lines[l.key] / top) * 100)}%` }} />
              </div>
              {l.key === "payroll" && <p className="mt-1 text-[11px] text-muted-foreground">{track.hours.toLocaleString()} hours clocked · wages before payroll taxes</p>}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 border-t pt-3 text-xs text-muted-foreground">
        <span>{track.billCount} bills · {whole(track.unpaid)} not paid yet</span>
        {track.openShifts > 0 && <span>{track.openShifts} crew still clocked in (added when they clock out)</span>}
        {track.missingRateHours > 0 && (
          <span className="text-amber-700 dark:text-amber-400">{track.missingRateHours} hours have no pay rate — payroll is short until a rate is set</span>
        )}
      </div>
    </section>
  );
}

/** Month-end: the app's tally next to the bank statement, line by line. */
export function MonthEndCheck({ rows, month, months, hasBank }: { rows: CompareRow[]; month: string; months: string[]; hasBank: boolean }) {
  const out = rows.filter((r) => r.key !== "receipts");
  const trackedOut = out.reduce((s, r) => s + r.tracked, 0);
  const bankOut = hasBank ? out.reduce((s, r) => s + (r.bank ?? 0), 0) : null;
  const cell = "whitespace-nowrap px-3 py-2 text-right tabular-nums";
  const flag = (d: number | null) => (d !== null && Math.abs(d) >= 100_00 ? "text-amber-700 dark:text-amber-400 font-medium" : "text-muted-foreground");
  return (
    <section className="min-w-0 rounded-xl border bg-card">
      <div className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Month-end check: app vs. bank</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          What the app tracked for the month next to what the bank statement shows. A big difference means a bill, a payroll run or a
          deposit is missing or in the wrong place.
        </p>
        <nav className="mt-3 flex gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="Month">
          {months.map((m) => (
            <Link key={m} href={`/finances?section=cash&m=${m}`} scroll={false} aria-current={m === month ? "page" : undefined}
              className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${m === month ? "bg-foreground text-background" : "bg-muted/60 text-muted-foreground hover:text-foreground"}`}>
              {monthShort(m)}
            </Link>
          ))}
        </nav>
      </div>
      {!hasBank && (
        <p className="mx-4 mb-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground sm:mx-5">
          {monthLong(month)}’s bank statement isn’t imported yet. The app column keeps filling in as the month goes; the bank column fills
          in when the statement is imported.
        </p>
      )}
      <div className="overflow-x-auto border-t">
        <table className="w-full min-w-[32rem] text-[13px]">
          <thead>
            <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-2 text-left font-medium">{monthLong(month)}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">In the app</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Bank</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={`border-b ${r.key === "receipts" ? "bg-emerald-500/5" : ""}`}>
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  {r.label}
                  {r.note && <span className="block text-[11px] text-muted-foreground">{r.note}</span>}
                </th>
                <td className={cell}>{acct(r.tracked)}</td>
                <td className={cell}>{r.bank === null ? "—" : acct(r.bank)}</td>
                <td className={`${cell} ${flag(r.diff)}`}>{r.diff === null ? "—" : Math.abs(r.diff) < 100_00 ? "Ties" : acct(r.diff)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="font-semibold">
            <tr>
              <th scope="row" className="px-4 py-2 text-left">Total costs</th>
              <td className={cell}>{whole(trackedOut)}</td>
              <td className={cell}>{bankOut === null ? "—" : whole(bankOut)}</td>
              <td className={`${cell} ${flag(bankOut === null ? null : trackedOut - bankOut)}`}>{bankOut === null ? "—" : acct(trackedOut - bankOut)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="p-4 text-[11px] leading-relaxed text-muted-foreground sm:px-5">
        Positive difference: the app has more than the bank (a bill not paid yet, or paid next month). Negative: money left the bank that
        the app doesn’t have — usually a bill that was never entered. Differences under $100 show as “Ties”.
      </p>
    </section>
  );
}
