import type { ReactNode } from "react";
import { fmtMoney } from "@/lib/portal-kit/format";

/**
 * The money summary card, copied from the client portal's Payments tab: a
 * label, the big number (always to the cent), an optional paid bar, then a
 * row of smaller figures. For the sub: "Your work on open jobs", then Paid
 * this year / Owed to you, with "Sent, waiting for Penney" kept apart.
 */

/** The paid green from the client portal. */
export const PAID_GREEN = "#2F6B4F";

export interface MoneyStat {
  label: string;
  /** Dollars; null prints the empty dash. */
  amount?: number | null;
  /** Shown instead of an amount ("2 invoices"). */
  text?: string;
  /** "paid" prints it green. */
  tone?: "paid" | "default";
}

export function MoneySummary({
  label,
  amount,
  note,
  progress,
  stats = [],
  children,
}: {
  label: string;
  amount: number | null;
  /** A line under the big number ("Includes $1,200.00 in changes"). */
  note?: ReactNode;
  /** Draws the green bar: value of total (e.g. paid of agreed). */
  progress?: { value: number; total: number };
  stats?: MoneyStat[];
  children?: ReactNode;
}) {
  const pct =
    progress && progress.total > 0 ? Math.max(0, Math.min(100, Math.round((progress.value / progress.total) * 100))) : 0;
  return (
    <section className="card p-4">
      <p className="label">{label}</p>
      <p className="mt-1 text-[30px] font-extrabold leading-none">{fmtMoney(amount)}</p>
      {note && <p className="mt-1.5 text-[15px] text-[var(--muted)]">{note}</p>}
      {progress && (
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--line)]">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: PAID_GREEN }} />
        </div>
      )}
      {stats.length > 0 && (
        <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 3)}, minmax(0, 1fr))` }}>
          {stats.map((s, i) => (
            <div key={s.label} className={i > 0 && i === stats.length - 1 ? "text-right" : ""}>
              <p className="label">{s.label}</p>
              <p className="text-[18px] font-extrabold" style={s.tone === "paid" ? { color: PAID_GREEN } : undefined}>
                {s.text ?? fmtMoney(s.amount)}
              </p>
            </div>
          ))}
        </div>
      )}
      {children}
    </section>
  );
}
