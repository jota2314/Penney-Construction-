import type { CollectionPace } from "@/lib/finance/collection-pace";

/**
 * The weekly / monthly collections scoreboard: what came in this week and this
 * month against the published plan, week by week, who paid, and the last six
 * months. Server-rendered; amounts are cents.
 */

const money = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const shortDay = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

function Bar({ value, of }: { value: number; of: number }) {
  const w = Math.min(100, Math.max(0, of > 0 ? (value / of) * 100 : 0));
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${w}%` }} />
    </div>
  );
}

export function CollectionPaceSummary({ pace }: { pace: CollectionPace }) {
  const { thisWeek, lastWeek, month } = pace;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">Collected this week · {thisWeek.label}</p>
        <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{money(thisWeek.collected)}</p>
        {thisWeek.target !== null ? (
          <>
            <Bar value={thisWeek.collected} of={thisWeek.target} />
            <p className="mt-2 text-xs text-muted-foreground">
              {pct(thisWeek.collected, thisWeek.target)}% of the {money(thisWeek.target)} target ·{" "}
              {money(Math.max(0, thisWeek.target - thisWeek.collected))} to go
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No target set for this week</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">Last week ({lastWeek.label}): {money(lastWeek.collected)}</p>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">Collected in {month.label}</p>
        <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{money(month.collected)}</p>
        {month.goal !== null ? (
          <>
            <Bar value={month.collected} of={month.goal} />
            <p className="mt-2 text-xs text-muted-foreground">
              {pct(month.collected, month.goal)}% of the {money(month.goal)} goal ·{" "}
              {money(Math.max(0, month.goal - month.collected))} to go
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No goal set for {month.label}</p>
        )}
      </div>
    </div>
  );
}

export function CollectionPace({ pace }: { pace: CollectionPace }) {
  return (
    <div className="space-y-4">
      <CollectionPaceSummary pace={pace} />
      <CollectionPaceHistory pace={pace} />
    </div>
  );
}

/** Week by week, who paid this week, and month by month — without the headline cards. */
export function CollectionPaceHistory({ pace }: { pace: CollectionPace }) {
  const { weeks, months, thisWeek, month } = pace;
  const monthTarget = weeks.reduce((s, w) => s + (w.target ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">{month.label}, week by week</h3>
            <p className="text-xs text-muted-foreground">Weeks run Monday to Sunday. Targets come from the sent collection plan.</p>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 sm:px-4 font-medium">Week</th>
                <th className="px-2 py-2 text-right font-medium">Target</th>
                <th className="px-2 py-2 text-right font-medium">Collected</th>
                <th className="px-3 py-2 sm:px-4 text-right font-medium">vs target</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => {
                const diff = w.target === null ? null : w.collected - w.target;
                // A week still in progress isn't a miss yet: show what's left.
                const toGo = w.current && diff !== null && diff < 0;
                return (
                  <tr key={w.start} className={`border-t ${w.current ? "bg-amber-500/10" : ""}`}>
                    <td className="whitespace-nowrap px-3 py-2.5 sm:px-4 font-medium">
                      {w.label}
                      {w.current && <span className="block text-[10px] font-semibold uppercase text-amber-600 sm:ml-2 sm:inline dark:text-amber-400">This week</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{w.target === null ? "—" : money(w.target)}</td>
                    <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{w.future ? "—" : money(w.collected)}</td>
                    <td
                      className={`px-3 py-2.5 sm:px-4 text-right tabular-nums ${
                        diff === null || w.future
                          ? "text-muted-foreground"
                          : toGo
                            ? "text-amber-600 dark:text-amber-400"
                            : diff >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {diff === null || w.future
                        ? "—"
                        : toGo
                          ? `${money(-diff)} to go`
                          : `${diff >= 0 ? "+" : "−"}${money(Math.abs(diff))}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="px-3 py-2.5 sm:px-4">Month</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{month.goal !== null ? money(month.goal) : monthTarget ? money(monthTarget) : "—"}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{money(month.collected)}</td>
                <td className="px-3 py-2.5 sm:px-4 text-right tabular-nums text-muted-foreground">
                  {month.goal !== null ? `${pct(month.collected, month.goal)}%` : ""}
                </td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Who paid this week · {thisWeek.label}</h3>
            <p className="text-xs text-muted-foreground">Client payments recorded in the app.</p>
          </div>
          {thisWeek.payments.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Nothing recorded yet this week.</p>
          ) : (
            <ul className="divide-y">
              {thisWeek.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.project}</span>
                    <span className="text-xs text-muted-foreground">
                      {shortDay(p.day)}
                      {p.type ? ` · ${p.type.replace(/_/g, " ")}` : ""}
                    </span>
                  </span>
                  <span className={`shrink-0 font-semibold tabular-nums ${p.cents < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{money(p.cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Month by month</h3>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 sm:px-4 font-medium">Month</th>
              <th className="px-2 py-2 text-right font-medium">Collected</th>
              <th className="px-2 py-2 text-right font-medium">Goal</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell sm:px-4">Payments</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.key} className={`border-t ${m.current ? "bg-amber-500/10" : ""}`}>
                <td className="whitespace-nowrap px-3 py-2.5 sm:px-4 font-medium">
                  {m.label}
                  {m.current && <span className="block text-[10px] font-semibold uppercase text-amber-600 sm:ml-2 sm:inline dark:text-amber-400">So far</span>}
                </td>
                <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{money(m.collected)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                  {m.goal === null ? "—" : `${money(m.goal)} · ${pct(m.collected, m.goal)}%`}
                </td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell sm:px-4">{m.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
