import Link from "next/link";
import type { OverheadReport } from "@/lib/finance/overhead";

/**
 * The overhead number the bid markup has to recover, shown the way it is
 * actually built: office payroll (split out of the bulk ADP debits) plus the
 * running costs of the business, with capital purchases held to one side so a
 * van never inflates the monthly rate.
 */

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1] ?? key} ${key.slice(2, 4)}`;

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-3.5">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums leading-tight ${accent ? "text-amber-500" : ""}`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function OverheadReportView({ report }: { report: OverheadReport }) {
  const {
    months,
    categories,
    totalOverhead,
    totalCapex,
    totalRevenue,
    pctOfRevenue,
    monthlyAverage,
    runRate,
    payrollThrough,
  } = report;

  const complete = months.filter((m) => m.officePayroll > 0);
  const maxTotal = Math.max(...complete.map((m) => m.total), 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Overhead so far"
          value={money(totalOverhead)}
          sub={payrollThrough ? `through ${monthLabel(payrollThrough)}` : "no payroll split on file"}
          accent
        />
        <Stat
          label="% of money collected"
          value={pctOfRevenue === null ? "—" : `${pctOfRevenue.toFixed(1)}%`}
          sub={`of ${money(totalRevenue)} in`}
        />
        <Stat
          label="Monthly average"
          value={money(monthlyAverage)}
          sub={`${complete.length} complete month${complete.length === 1 ? "" : "s"}`}
        />
        <Stat
          label="Latest month"
          value={runRate === null ? "—" : money(runRate)}
          sub="closest thing to today's run rate"
        />
      </div>

      {/* Month by month */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-3.5 py-2.5 border-b bg-muted/20 text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">
          Month by month
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-semibold px-3.5 py-2">Month</th>
                <th className="text-right font-semibold px-2 py-2">Office pay</th>
                <th className="text-right font-semibold px-2 py-2">Running costs</th>
                <th className="text-right font-semibold px-2 py-2">Overhead</th>
                <th className="text-right font-semibold px-2 py-2">% of in</th>
                <th className="text-right font-semibold px-3.5 py-2">Vans & equipment</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const blind = m.officePayroll === 0;
                return (
                  <tr key={m.month} className="border-t">
                    <td className="px-3.5 py-2 font-medium">
                      {monthLabel(m.month)}
                      {blind && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground italic">
                          no payroll split
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                      {m.officePayroll > 0 ? money(m.officePayroll + m.payrollFees) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                      {money(m.nonPayroll)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold">
                      {money(m.total)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                      {m.pctOfRevenue === null ? "—" : `${m.pctOfRevenue.toFixed(1)}%`}
                    </td>
                    <td className="px-3.5 py-2 text-right tabular-nums text-muted-foreground">
                      {m.capex > 0 ? money(m.capex) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/20 font-semibold">
                <td className="px-3.5 py-2">Total</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {money(complete.reduce((s, m) => s + m.officePayroll + m.payrollFees, 0))}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {money(months.reduce((s, m) => s + m.nonPayroll, 0))}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{money(totalOverhead)}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {pctOfRevenue === null ? "—" : `${pctOfRevenue.toFixed(1)}%`}
                </td>
                <td className="px-3.5 py-2 text-right tabular-nums">{money(totalCapex)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        {/* Shape of the months */}
        <div className="rounded-xl border bg-card p-3.5">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">
            What it costs each month
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {complete.map((m) => (
              <div key={m.month} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {monthLabel(m.month)}
                </span>
                <div className="flex-1 h-5 rounded bg-muted/40 overflow-hidden flex">
                  <div
                    className="h-full bg-amber-600"
                    style={{ width: `${((m.officePayroll + m.payrollFees) / maxTotal) * 100}%` }}
                    title="Office payroll"
                  />
                  <div
                    className="h-full bg-amber-500/40"
                    style={{ width: `${(m.nonPayroll / maxTotal) * 100}%` }}
                    title="Running costs"
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-[11px] font-semibold tabular-nums">
                  {money(m.total)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-amber-600" /> Office payroll
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-amber-500/40" /> Running costs
            </span>
          </div>
        </div>

        {/* Where the running costs go */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-3.5 py-2.5 border-b bg-muted/20 text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">
            Running costs by category
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {categories.map((c) => (
              <div
                key={c.label}
                className="flex items-center justify-between gap-2 px-3.5 py-2 border-b last:border-b-0"
              >
                <span className="text-[12.5px] truncate">{c.label}</span>
                <span className="text-[12px] font-semibold tabular-nums shrink-0">
                  {money2(c.total)}
                </span>
              </div>
            ))}
            {categories.length === 0 && (
              <div className="px-3.5 py-6 text-center text-xs text-muted-foreground italic">
                Nothing booked to the Overhead project yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* How this is computed — the part that stops the number being argued about */}
      <div className="rounded-xl border bg-card p-3.5 text-[12px] text-muted-foreground leading-relaxed">
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold mb-1.5">
          How this is worked out
        </div>
        <p className="mb-1.5">
          <strong className="text-foreground">Office pay only.</strong> ADP debits are one bulk
          bank line per run covering everybody, so the office/field split comes from the ADP
          payroll reports and adds back to each month&apos;s ADP cash exactly. The field crew&apos;s
          wages are a job cost — they are already priced into estimate line items, so counting
          them here too would charge for the same labor twice.
        </p>
        <p className="mb-1.5">
          <strong className="text-foreground">Vans and equipment are kept out of the rate.</strong>{" "}
          Buying a truck turns cash into something the company owns; it is money out but not a
          monthly cost. It shows in its own column, and only its running costs (leases, fuel,
          repairs, registration) sit in overhead.
        </p>
        <p>
          <strong className="text-foreground">Everything here is bank-tied.</strong> Every row
          comes from a cleared transaction —{" "}
          <Link href="/spent" className="text-amber-500 hover:underline">
            Expenses
          </Link>{" "}
          shows the same dollars line by line, and{" "}
          <Link href="/spent/review" className="text-amber-500 hover:underline">
            costs still to sort out
          </Link>{" "}
          are the ones that could still move this number.
        </p>
      </div>
    </div>
  );
}
