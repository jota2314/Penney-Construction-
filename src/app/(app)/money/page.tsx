import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Money | Penney Construction" };

// One screen, three questions, bank numbers only: what came in, what went
// out, what we kept. Every figure is an Eastern statement line — the same
// totals printed on the statement, so this page can never drift from the
// bank. Job-by-job costing lives on the project pages; the transaction list
// lives on /spent. This page exists so the owner can see the money in ten
// seconds without either.

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

interface BankRow {
  txn_date: string;
  description: string | null;
  amount: number | null;
  direction: string | null;
  check_number: string | null;
  category_key: string | null;
}

interface MonthAgg {
  key: string; // "2026-07"
  label: string; // "July"
  moneyIn: number;
  moneyOut: number;
  payroll: number;
  cardPayoff: number;
  checks: number;
  other: number;
  lastTxn: string;
}

const monthLabel = (key: string): string =>
  new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString("en-US", { month: "long" });

export default async function MoneyPage({
  searchParams,
}: {
  searchParams?: Promise<{ m?: string }>;
}) {
  const user = await requireAuth();
  // Same line as the board's money gate: owners + precon see dollars.
  if (!canSeeBoardMoney(user.profile?.role)) redirect("/command-center");

  const params = (await searchParams) || {};
  const supabase = await createClient();

  // Eastern statement lines only — the card's own ledger (capone) is the
  // detail behind the payoffs, not bank cash, so it never counts here.
  const rows: BankRow[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 10 * PAGE; from += PAGE) {
    const { data } = await supabase
      .from("bank_transactions")
      .select("txn_date, description, amount, direction, check_number, category_key")
      .like("source", "eastern%")
      .order("txn_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    const batch = (data ?? []) as BankRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const months = new Map<string, MonthAgg>();
  for (const r of rows) {
    const key = r.txn_date.slice(0, 7);
    let m = months.get(key);
    if (!m) {
      m = { key, label: monthLabel(key), moneyIn: 0, moneyOut: 0, payroll: 0, cardPayoff: 0, checks: 0, other: 0, lastTxn: r.txn_date };
      months.set(key, m);
    }
    const amt = Number(r.amount || 0);
    if (r.txn_date > m.lastTxn) m.lastTxn = r.txn_date;
    if (r.direction === "credit") {
      m.moneyIn += amt;
      continue;
    }
    m.moneyOut += amt;
    if (/ADP (WAGE PAY|Tax|PAYROLL FEES)/i.test(r.description ?? "")) m.payroll += amt;
    else if (r.category_key === "card_payoff") m.cardPayoff += amt;
    else if (r.check_number) m.checks += amt;
    else m.other += amt;
  }
  const monthList = [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
  if (monthList.length === 0) {
    return (
      <>
        <Header title="Money" backHref="/command-center" />
        <div className="p-6 text-sm text-muted-foreground">No bank statements loaded yet.</div>
      </>
    );
  }

  const latest = monthList[monthList.length - 1];
  const selected = monthList.find(m => m.key === params.m) ?? latest;
  const kept = selected.moneyIn - selected.moneyOut;

  // A month is "partial" when its statement lines stop before month-end —
  // e.g. August loaded through the 8th. Say so instead of looking like a
  // terrible month.
  const monthEndDay = new Date(Number(selected.key.slice(0, 4)), Number(selected.key.slice(5, 7)), 0).getDate();
  const isPartial = Number(selected.lastTxn.slice(8, 10)) < monthEndDay;

  const ytdIn = monthList.reduce((s, m) => s + m.moneyIn, 0);
  const ytdOut = monthList.reduce((s, m) => s + m.moneyOut, 0);

  const maxBar = Math.max(...monthList.map(m => Math.max(m.moneyIn, m.moneyOut)), 1);

  const OUT_PIECES: { label: string; sub: string; value: number; dot: string }[] = [
    { label: "Payroll", sub: "ADP — wages, taxes, fees", value: selected.payroll, dot: "bg-lime-500" },
    { label: "Checks", sub: "subs and vendors", value: selected.checks, dot: "bg-violet-500" },
    { label: "Card payoff", sub: "Capital One Visa + Amex", value: selected.cardPayoff, dot: "bg-stone-500" },
    { label: "Direct payments", sub: "ACH, debit card, insurance, fees", value: selected.other, dot: "bg-sky-500" },
  ].sort((a, b) => b.value - a.value);
  const maxPiece = OUT_PIECES[0]?.value || 1;

  return (
    <>
      <Header title="Money" backHref="/command-center" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8 max-w-3xl">
        {/* Month switcher */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {monthList.map(m => (
            <Link
              key={m.key}
              href={`/money?m=${m.key}`}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                m.key === selected.key ? "bg-background text-foreground shadow-sm border" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label.slice(0, 3)}
            </Link>
          ))}
        </div>

        <div>
          <div className="text-[15px] font-semibold">
            {selected.label} 2026
            {isPartial && (
              <span className="ml-2 text-[11px] font-normal text-amber-500">
                statement loaded through {new Date(selected.lastTxn + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} — not the full month yet
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Straight from the Eastern Bank statement. These numbers cannot drift — they are the bank&apos;s own totals.
          </div>
        </div>

        {/* The three jars */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Came in</div>
            <div className="text-xl sm:text-2xl font-bold tabular-nums mt-1 text-emerald-500">{fmt(selected.moneyIn)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">client deposits</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Went out</div>
            <div className="text-xl sm:text-2xl font-bold tabular-nums mt-1 text-amber-500">{fmt(selected.moneyOut)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">everything paid</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Kept</div>
            <div className={`text-xl sm:text-2xl font-bold tabular-nums mt-1 ${kept >= 0 ? "text-foreground" : "text-red-400"}`}>
              {fmt(kept)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{kept >= 0 ? "stayed in the bank" : "came out of the bank"}</div>
          </div>
        </div>

        {/* Where it went, in plain words */}
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">Where {selected.label}&apos;s money went</h2>
          <div className="mt-3 flex flex-col gap-2.5">
            {OUT_PIECES.filter(p => p.value > 0).map(p => (
              <div key={p.label}>
                <div className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${p.dot}`} />
                    <span className="font-medium">{p.label}</span>
                    <span className="text-muted-foreground truncate">· {p.sub}</span>
                  </span>
                  <span className="tabular-nums font-semibold shrink-0">
                    {fmt(p.value)}
                    <span className="text-muted-foreground font-normal ml-1.5">
                      {selected.moneyOut > 0 ? Math.round((p.value / selected.moneyOut) * 100) : 0}%
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${p.dot}`} style={{ width: `${Math.min((p.value / maxPiece) * 100, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <Link href={`/spent?range=month&offset=${monthOffset(selected.key)}`} className="mt-3 inline-block text-[12px] font-medium text-amber-500">
            See every transaction →
          </Link>
        </div>

        {/* Month by month: in vs out */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Month by month</h2>
            <div className="text-[11px] text-muted-foreground">
              year so far: in {fmt(ytdIn)} · out {fmt(ytdOut)} · kept {fmt(ytdIn - ytdOut)}
            </div>
          </div>
          <div className="mt-3 flex items-end gap-2">
            {monthList.map(m => {
              const inPx = Math.max(Math.round((m.moneyIn / maxBar) * 88), m.moneyIn > 0 ? 3 : 2);
              const outPx = Math.max(Math.round((m.moneyOut / maxBar) * 88), m.moneyOut > 0 ? 3 : 2);
              const net = m.moneyIn - m.moneyOut;
              return (
                <Link
                  key={m.key}
                  href={`/money?m=${m.key}`}
                  title={`${m.label}: in ${fmt(m.moneyIn)}, out ${fmt(m.moneyOut)}, kept ${fmt(net)}`}
                  className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1 hover:opacity-80"
                >
                  <span className={`text-[9px] leading-none tabular-nums ${net >= 0 ? "text-emerald-500" : "text-red-400"}`}>
                    {net >= 0 ? "+" : "−"}{Math.round(Math.abs(net) / 1000)}k
                  </span>
                  <div className="w-full flex items-end justify-center gap-[2px]">
                    <div className="w-[38%] max-w-[16px] rounded-t-[3px] bg-emerald-500/70" style={{ height: `${inPx}px` }} />
                    <div className="w-[38%] max-w-[16px] rounded-t-[3px] bg-amber-500/70" style={{ height: `${outPx}px` }} />
                  </div>
                  <span className={`text-[9px] leading-none ${m.key === selected.key ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                    {m.label.slice(0, 3)}
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500/70" /> came in</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500/70" /> went out</span>
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground leading-relaxed">
          How to read this page: <span className="text-foreground">Came in</span> is client money hitting the bank.{" "}
          <span className="text-foreground">Went out</span> is every payment that cleared — payroll, checks, the card payoff, everything.{" "}
          <span className="text-foreground">Kept</span> is the difference: what actually stayed. What each <em>job</em> made lives on the
          project pages; this page is the company&apos;s wallet.
        </div>
      </div>
    </>
  );
}

// /spent takes a month as an offset from the current month.
function monthOffset(key: string): number {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return (Number(key.slice(0, 4)) - now.getFullYear()) * 12 + (Number(key.slice(5, 7)) - 1 - now.getMonth());
}
