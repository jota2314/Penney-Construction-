import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { FinanceTabs } from "@/components/finances/finance-tabs";
import { loadLedger, buildPnl, build1099, type PnlRow } from "@/lib/finance/ledger";
import { BooksChart } from "@/components/books/books-chart";
import { BooksClose, type CloseEvent, type CloseMonthRow } from "@/components/books/books-close";
import { BooksUncategorized, type UnassignedLine } from "@/components/books/books-uncategorized";
import { Books1099 } from "@/components/books/books-1099";

export const metadata: Metadata = { title: "Finances — Books | Penney Construction" };

// The books: what the CPA gets. Cash basis, built from the bank ledger
// (every Eastern and Capital One statement line with its account), so the
// P&L here ties to the statements by construction. Five sections:
//   P&L            income / job costs / overhead by month, transfers and
//                  asset purchases kept out and shown separately
//   To place       bank lines the rules could not put in an account
//   Chart          the accounts themselves, editable
//   Close          month lock + log
//   1099           check/ACH payments per sub, W-9 status

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Tab = "pnl" | "place" | "chart" | "close" | "1099";
const TABS: { key: Tab; label: string }[] = [
  { key: "pnl", label: "P&L" },
  { key: "place", label: "To place" },
  { key: "chart", label: "Chart of accounts" },
  { key: "close", label: "Close" },
  { key: "1099", label: "1099s" },
];

export default async function BooksPage({ searchParams }: { searchParams?: Promise<{ tab?: string; year?: string }> }) {
  const user = await requireAuth();
  if (!canSeeBoardMoney(user.profile?.role)) redirect("/command-center");
  const isOwner = (user.realProfile?.role ?? user.profile?.role) === "owner";

  const params = (await searchParams) || {};
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const year = Number(params.year) || nowET.getFullYear();
  const tab: Tab = (TABS.some((t) => t.key === params.tab) ? params.tab : "pnl") as Tab;

  const supabase = await createClient();
  const { lines, accounts } = await loadLedger(supabase, `${year}-01-01`, `${year}-12-31`);
  const pnl = buildPnl(lines, year, accounts);

  // YTD per account for the chart tab.
  const ytdByAccount: Record<string, { debits: number; credits: number; count: number }> = {};
  for (const l of lines) {
    const e = (ytdByAccount[l.account.id] ??= { debits: 0, credits: 0, count: 0 });
    if (l.direction === "debit") e.debits += l.amount;
    else e.credits += l.amount;
    e.count += 1;
  }

  // Lines with no home. After the backfill these are exactly the rows a
  // human has to decide.
  const unplaced: UnassignedLine[] = lines
    .filter((l) => l.account.id === accounts.uncategorized.id)
    .map((l) => ({
      id: l.id,
      date: l.date,
      description: l.description,
      vendor: l.vendor_name,
      amount: l.amount,
      direction: l.direction,
      source: l.source,
      checkNumber: l.check_number,
      inferred: l.inferred,
      guess: null,
    }));

  const [{ count: invoicesWithout }, { count: bankWithout }, { data: periods }, { data: events }] = await Promise.all([
    supabase.from("invoices").select("id", { count: "exact", head: true }).is("account_id", null),
    supabase.from("bank_transactions").select("id", { count: "exact", head: true }).is("account_id", null),
    supabase
      .from("accounting_periods")
      .select("month, status, locked_at, note, locked_by:profiles!accounting_periods_locked_by_fkey(full_name)")
      .gte("month", `${year}-01-01`)
      .lte("month", `${year}-12-01`),
    supabase
      .from("accounting_period_events")
      .select("id, month, action, note, created_at, actor:profiles!accounting_period_events_actor_id_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const periodByMonth = new Map<string, { status: "open" | "locked"; locked_at: string | null; note: string | null; locked_by_name: string | null }>();
  for (const p of periods ?? []) {
    const lb = (Array.isArray(p.locked_by) ? p.locked_by[0] : p.locked_by) as { full_name: string | null } | null;
    periodByMonth.set(String(p.month).slice(0, 7), {
      status: p.status as "open" | "locked",
      locked_at: p.locked_at,
      note: p.note,
      locked_by_name: lb?.full_name ?? null,
    });
  }
  const lastMonth = year === nowET.getFullYear() ? nowET.getMonth() : 11;
  const months: CloseMonthRow[] = [];
  for (let m = 0; m <= lastMonth; m++) {
    const key = `${year}-${String(m + 1).padStart(2, "0")}`;
    const inMonth = lines.filter((l) => l.date.startsWith(key) && (l.source ?? "").startsWith("eastern"));
    const p = periodByMonth.get(key);
    months.push({
      month: key,
      label: `${MONTH_LONG[m]} ${year}`,
      status: p?.status ?? "open",
      statementIn: inMonth.filter((l) => l.direction === "credit").reduce((s, l) => s + l.amount, 0),
      statementOut: inMonth.filter((l) => l.direction === "debit").reduce((s, l) => s + l.amount, 0),
      lines: inMonth.length,
      unassigned: lines.filter((l) => l.date.startsWith(key) && l.account.id === accounts.uncategorized.id).length,
      hasStatement: inMonth.length > 0,
      lockedAt: p?.locked_at ?? null,
      lockedBy: p?.locked_by_name ?? null,
      note: p?.note ?? null,
    });
  }
  months.reverse();
  const closeEvents: CloseEvent[] = (events ?? []).map((e) => {
    const actor = (Array.isArray(e.actor) ? e.actor[0] : e.actor) as { full_name: string | null } | null;
    return { id: e.id, month: String(e.month).slice(0, 7), action: e.action as "lock" | "reopen", actor: actor?.full_name ?? null, note: e.note, at: e.created_at };
  });

  const nineNine = tab === "1099" ? await build1099(supabase, year) : null;

  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const qs = (t: Tab, y = year) => `/books?tab=${t}&year=${y}`;

  const PnlSection = ({ title, rows, totals, tone }: { title: string; rows: PnlRow[]; totals: number[]; tone: string }) => (
    <>
      <tr className="bg-muted/40">
        <td colSpan={14} className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.account.id} className="border-t">
          <td className="px-3 py-1.5 text-[12.5px] sticky left-0 bg-card">
            <span className="text-muted-foreground tabular-nums mr-2">{r.account.code}</span>
            {r.account.name}
          </td>
          {r.byMonth.map((v, i) => (
            <td key={i} className={`px-2 py-1.5 text-right tabular-nums text-[12px] ${v === 0 ? "text-muted-foreground/40" : ""}`}>
              {v === 0 ? "·" : fmt(v)}
            </td>
          ))}
          <td className="px-3 py-1.5 text-right tabular-nums text-[12.5px] font-semibold">{fmt(r.total)}</td>
        </tr>
      ))}
      <tr className={`border-t font-semibold ${tone}`}>
        <td className="px-3 py-1.5 text-[12.5px] sticky left-0 bg-card">Total {title.toLowerCase()}</td>
        {totals.map((v, i) => (
          <td key={i} className="px-2 py-1.5 text-right tabular-nums text-[12px]">
            {v === 0 ? "·" : fmt(v)}
          </td>
        ))}
        <td className="px-3 py-1.5 text-right tabular-nums text-[12.5px]">{fmt(sum(totals))}</td>
      </tr>
    </>
  );

  const ProfitRow = ({ label, values, strong }: { label: string; values: number[]; strong?: boolean }) => (
    <tr className={`border-t ${strong ? "bg-amber-500/10" : ""}`}>
      <td className={`px-3 py-2 text-[13px] sticky left-0 ${strong ? "bg-amber-500/10 font-bold" : "bg-card font-semibold"}`}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`px-2 py-2 text-right tabular-nums text-[12px] ${v < 0 ? "text-red-400" : ""} ${strong ? "font-bold" : "font-semibold"}`}>
          {v === 0 ? "·" : fmt(v)}
        </td>
      ))}
      <td className={`px-3 py-2 text-right tabular-nums text-[13px] ${sum(values) < 0 ? "text-red-400" : ""} ${strong ? "font-bold" : "font-semibold"}`}>
        {fmt(sum(values))}
      </td>
    </tr>
  );

  const totalIncome = sum(pnl.totals.income);
  const totalCogs = sum(pnl.totals.cogs);
  const totalExpense = sum(pnl.totals.expense);
  const net = sum(pnl.totals.netProfit);

  return (
    <>
      <Header title="Finances" backHref="/command-center" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        <FinanceTabs current="books" />

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex bg-muted rounded-lg p-0.5 flex-wrap">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={qs(t.key)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
                {t.key === "place" && unplaced.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold text-amber-500 tabular-nums">{unplaced.length}</span>
                )}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-1 text-sm">
            <Link href={qs(tab, year - 1)} className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground">←</Link>
            <span className="font-semibold tabular-nums">{year}</span>
            <Link href={qs(tab, year + 1)} className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground">→</Link>
          </div>
        </div>

        {tab === "pnl" && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "Income", value: totalIncome, cls: "text-emerald-500" },
                { label: "Job costs", value: totalCogs, cls: "" },
                { label: "Gross profit", value: totalIncome - totalCogs, cls: totalIncome - totalCogs < 0 ? "text-red-400" : "" },
                { label: "Overhead", value: totalExpense, cls: "text-orange-500" },
                { label: "Net profit", value: net, cls: net < 0 ? "text-red-400" : "text-amber-500" },
              ].map((t) => (
                <div key={t.label} className="rounded-lg border bg-card p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{t.label}</div>
                  <div className={`text-xl font-bold tabular-nums mt-0.5 ${t.cls}`}>{fmt(t.value)}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap text-[12px] text-muted-foreground">
              <div>
                Cash basis, from {lines.length.toLocaleString()} statement lines. Card charges count when charged; the payoff is a transfer.
                {pnl.uncategorizedCount > 0 && (
                  <>
                    {" "}
                    <Link href={qs("place")} className="text-amber-500 font-medium">
                      {pnl.uncategorizedCount} lines are Uncategorized →
                    </Link>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                {[
                  { label: "P&L CSV", href: `/api/books/export?report=pnl&year=${year}` },
                  { label: "Trial balance", href: `/api/books/export?report=trial-balance&year=${year}` },
                  { label: "Full ledger", href: `/api/books/export?report=ledger&year=${year}` },
                ].map((d) => (
                  <a key={d.label} href={d.href} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11.5px] font-medium hover:bg-muted/40">
                    <Download className="h-3 w-3" /> {d.label}
                  </a>
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-card overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse">
                <thead>
                  <tr className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left font-semibold sticky left-0 bg-card">Account</th>
                    {MONTH_SHORT.map((m) => (
                      <th key={m} className="px-2 py-2 text-right font-semibold">{m}</th>
                    ))}
                    <th className="px-3 py-2 text-right font-semibold">{year}</th>
                  </tr>
                </thead>
                <tbody>
                  <PnlSection title="Income" rows={pnl.income} totals={pnl.totals.income} tone="text-emerald-500" />
                  <PnlSection title="Job costs" rows={pnl.cogs} totals={pnl.totals.cogs} tone="" />
                  <ProfitRow label="Gross profit" values={pnl.totals.grossProfit} />
                  <PnlSection title="Overhead" rows={pnl.expense} totals={pnl.totals.expense} tone="text-orange-500" />
                  <ProfitRow label="Net profit" values={pnl.totals.netProfit} strong />
                  {pnl.nonPnl.length > 0 && (
                    <PnlSection title="Not P&L · transfers, assets, loans, owner" rows={pnl.nonPnl} totals={pnl.months.map((_, i) => pnl.nonPnl.reduce((s, r) => s + r.byMonth[i], 0))} tone="text-muted-foreground" />
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "place" && (
          <BooksUncategorized
            lines={unplaced}
            accounts={accounts.all}
            totals={{ invoicesWithout: invoicesWithout ?? 0, bankWithout: bankWithout ?? 0 }}
          />
        )}

        {tab === "chart" && <BooksChart accounts={accounts.all} ytdByAccount={ytdByAccount} year={year} />}

        {tab === "close" && <BooksClose months={months} events={closeEvents} isOwner={isOwner} />}

        {tab === "1099" && nineNine && (
          <>
            <div className="flex justify-end">
              <a
                href={`/api/books/export?report=1099&year=${year}`}
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11.5px] font-medium hover:bg-muted/40"
              >
                <Download className="h-3 w-3" /> 1099 CSV
              </a>
            </div>
            <Books1099 rows={nineNine.rows} year={year} threshold={nineNine.threshold} />
          </>
        )}
      </div>
    </>
  );
}
