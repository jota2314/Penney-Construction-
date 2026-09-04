"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runAccountBackfill, setBankLinesAccount } from "@/lib/actions/books";
import { ACCOUNT_TYPE_LABEL, ACCOUNT_TYPE_ORDER, type Account } from "@/lib/finance/accounts";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

export interface UnassignedLine {
  id: string;
  date: string;
  description: string | null;
  vendor: string | null;
  amount: number;
  direction: "debit" | "credit";
  source: string | null;
  checkNumber: string | null;
  /** True when the rules guessed an account from the description alone. */
  inferred: boolean;
  guess: { code: string; name: string } | null;
}

function groupKey(l: UnassignedLine): string {
  const base = (l.vendor || l.description || "unknown").toLowerCase();
  return base
    .replace(/\d{4,}/g, "")
    .replace(/(electronic payment|preauthorized (credit|debit)|debit card purchase|pos purchase|check #?)/g, "")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40) || "unknown";
}

/**
 * Bank lines the books cannot place. Grouped by who the money went to so a
 * whole vendor gets an account in one tap. Anything left here counts as
 * "Uncategorized" on the P&L until someone decides.
 */
export function BooksUncategorized({ lines, accounts, totals }: {
  lines: UnassignedLine[];
  accounts: Account[];
  totals: { invoicesWithout: number; bankWithout: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; lines: UnassignedLine[]; total: number }>();
    for (const l of lines) {
      const key = groupKey(l);
      const g = map.get(key) ?? { key, label: l.vendor || l.description || "Unknown", lines: [], total: 0 };
      g.lines.push(l);
      g.total += l.direction === "debit" ? l.amount : -l.amount;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [lines]);

  const active = accounts.filter((a) => a.is_active);

  function apply(g: { key: string; lines: UnassignedLine[] }) {
    const accountId = choice[g.key];
    if (!accountId) return;
    setError(null);
    startTransition(async () => {
      const res = await setBankLinesAccount({ bankTransactionIds: g.lines.map((l) => l.id), accountId });
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function backfill() {
    setError(null);
    setStatus("Running…");
    startTransition(async () => {
      const res = await runAccountBackfill();
      if (res.error) {
        setError(res.error);
        setStatus(null);
        return;
      }
      setStatus(
        `Stamped ${res.invoices?.stamped ?? 0} bills (${res.invoices?.remaining ?? 0} left) and ${res.bank?.stamped ?? 0} bank lines (${res.bank?.remaining ?? 0} left without an account).`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border bg-card p-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[12.5px]">
          <div className="font-medium">
            {totals.invoicesWithout.toLocaleString()} bills and {totals.bankWithout.toLocaleString()} bank lines have no stored account.
          </div>
          <div className="text-muted-foreground">
            Backfill stamps each one with the account the rules already use on screen — nothing changes, it just becomes
            stored and editable. Run it once; it is safe to run again.
          </div>
          {status && <div className="mt-1 text-emerald-500">{status}</div>}
        </div>
        <button
          onClick={backfill}
          disabled={pending}
          className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
        >
          {pending ? "Working…" : "Run backfill"}
        </button>
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}

      {groups.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          Every bank line this year has an account.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            {lines.length.toLocaleString()} lines the rules could not place · pick an account per group
          </div>
          {groups.map((g) => (
            <div key={g.key} className="rounded-lg border bg-card">
              <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <div className="text-[13px] font-medium truncate">{g.label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {g.lines.length} line{g.lines.length === 1 ? "" : "s"} · {money(Math.abs(g.total))}
                    {g.lines[0].guess && <> · rules guess: {g.lines[0].guess.name}</>}
                  </div>
                </div>
                <select
                  value={choice[g.key] ?? ""}
                  onChange={(e) => setChoice({ ...choice, [g.key]: e.target.value })}
                  className="rounded-md border bg-background px-2 py-1.5 text-sm max-w-[240px]"
                >
                  <option value="">Account…</option>
                  {ACCOUNT_TYPE_ORDER.map((t) => {
                    const opts = active.filter((a) => a.type === t);
                    if (opts.length === 0) return null;
                    return (
                      <optgroup key={t} label={ACCOUNT_TYPE_LABEL[t]}>
                        {opts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} {a.name}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                <button
                  onClick={() => apply(g)}
                  disabled={pending || !choice[g.key]}
                  className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-500 hover:bg-amber-500/10 disabled:opacity-40"
                >
                  Apply to {g.lines.length}
                </button>
              </div>
              <details className="border-t">
                <summary className="px-3 py-1.5 text-[11px] text-muted-foreground cursor-pointer">Show lines</summary>
                <div className="divide-y">
                  {g.lines.slice(0, 50).map((l) => (
                    <div key={l.id} className="px-3 py-1.5 text-[12px] flex items-center gap-2">
                      <span className="text-muted-foreground tabular-nums shrink-0 w-20">{l.date}</span>
                      <span className="truncate flex-1">{l.description}</span>
                      {l.checkNumber && <span className="text-muted-foreground shrink-0">ck {l.checkNumber}</span>}
                      <span className={`tabular-nums shrink-0 ${l.direction === "credit" ? "text-emerald-500" : ""}`}>
                        {l.direction === "credit" ? "+" : ""}
                        {money(l.amount)}
                      </span>
                    </div>
                  ))}
                  {g.lines.length > 50 && (
                    <div className="px-3 py-1.5 text-[11px] text-muted-foreground">+ {g.lines.length - 50} more</div>
                  )}
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
