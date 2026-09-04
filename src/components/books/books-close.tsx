"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Unlock } from "lucide-react";
import { lockMonth, reopenMonth } from "@/lib/actions/books";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

export interface CloseMonthRow {
  month: string; // YYYY-MM
  label: string; // "August 2026"
  status: "open" | "locked";
  statementIn: number;
  statementOut: number;
  lines: number;
  unassigned: number;
  hasStatement: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
  note: string | null;
}

export interface CloseEvent {
  id: string;
  month: string;
  action: "lock" | "reopen";
  actor: string | null;
  note: string | null;
  at: string;
}

/**
 * Month close. Locking a month makes the database reject any change to a
 * bill, bank line, or client payment dated in it — amounts, dates, jobs,
 * accounts. Approvals, QuickBooks ids and notes still save. Owners only;
 * reopening requires a reason and is logged.
 */
export function BooksClose({ months, events, isOwner }: { months: CloseMonthRow[]; events: CloseEvent[]; isOwner: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reopening, setReopening] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function lock(m: CloseMonthRow) {
    if (m.unassigned > 0 && !confirm(`${m.unassigned} line${m.unassigned === 1 ? "" : "s"} in ${m.label} still have no account. Close it anyway?`)) return;
    startTransition(async () => {
      const res = await lockMonth({ month: `${m.month}-01` });
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function reopen(m: CloseMonthRow) {
    startTransition(async () => {
      const res = await reopenMonth({ month: `${m.month}-01`, note: reason });
      if (res.error) setError(res.error);
      else {
        setReopening(null);
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-muted-foreground max-w-xl">
        A closed month is frozen: nothing dated inside it can change amount, date, job, or account. Close a month once
        its statement is loaded and every line has an account. Only an owner can close or reopen; reopening is logged.
      </p>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1fr_110px_110px_90px_150px] gap-2 px-3 py-2 border-b bg-muted/40 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Month</span>
          <span className="text-right">In</span>
          <span className="text-right">Out</span>
          <span className="text-right">No account</span>
          <span className="text-right">Status</span>
        </div>
        <div className="divide-y">
          {months.map((m) => (
            <div key={m.month} className="px-3 py-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-[1fr_110px_110px_90px_150px] gap-2 items-center">
                <div>
                  <div className="text-[13px] font-medium">{m.label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {m.hasStatement ? `${m.lines.toLocaleString()} statement lines` : "statement not loaded"}
                    {m.status === "locked" && m.lockedAt && (
                      <>
                        {" "}· closed {new Date(m.lockedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {m.lockedBy ? ` by ${m.lockedBy}` : ""}
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right tabular-nums text-[13px] text-emerald-500">{m.hasStatement ? money(m.statementIn) : "—"}</div>
                <div className="text-right tabular-nums text-[13px]">{m.hasStatement ? money(m.statementOut) : "—"}</div>
                <div className={`text-right tabular-nums text-[13px] ${m.unassigned > 0 ? "text-amber-500 font-semibold" : "text-muted-foreground"}`}>
                  {m.hasStatement ? m.unassigned : "—"}
                </div>
                <div className="col-span-2 sm:col-span-1 flex justify-end">
                  {m.status === "locked" ? (
                    isOwner ? (
                      <button
                        onClick={() => setReopening(reopening === m.month ? null : m.month)}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 px-2 py-1 text-[11px] font-semibold text-emerald-500"
                      >
                        <Lock className="h-3 w-3" /> Closed · reopen
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-500">
                        <Lock className="h-3 w-3" /> Closed
                      </span>
                    )
                  ) : isOwner ? (
                    <button
                      onClick={() => lock(m)}
                      disabled={pending || !m.hasStatement}
                      title={m.hasStatement ? "Freeze this month" : "Load the statement first"}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
                    >
                      <Unlock className="h-3 w-3" /> Close month
                    </button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Open</span>
                  )}
                </div>
              </div>
              {reopening === m.month && (
                <div className="mt-2 flex gap-2 items-center">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why is it being reopened? (goes in the log)"
                    className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
                  />
                  <button
                    onClick={() => reopen(m)}
                    disabled={pending || !reason.trim()}
                    className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-400 disabled:opacity-40"
                  >
                    Reopen
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {events.length > 0 && (
        <div className="rounded-lg border bg-card">
          <div className="px-3 py-2 border-b text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Close log</div>
          <div className="divide-y">
            {events.map((e) => (
              <div key={e.id} className="px-3 py-2 text-[12px] flex items-baseline gap-2">
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {new Date(e.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <span className={`font-semibold shrink-0 ${e.action === "lock" ? "text-emerald-500" : "text-red-400"}`}>
                  {e.action === "lock" ? "Closed" : "Reopened"}
                </span>
                <span className="shrink-0">{e.month}</span>
                <span className="text-muted-foreground truncate">
                  {e.actor ? `· ${e.actor}` : ""}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
