import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { FinanceTabs } from "@/components/finances/finance-tabs";

export const metadata: Metadata = { title: "Finances | Penney Construction" };

// The company's financial dashboard. One operating rhythm, one screen:
// every week the office books everything into the app; once a month the
// bank statement loads and each month reconciles against it — payments that
// didn't clear roll forward. So this page answers, full-year and full-width:
// what came in, what went out, what we kept, what's still owed both ways,
// and whether each month's books tie to the bank yet. Every cash figure is
// an Eastern statement line — the bank's own totals, never a re-add.

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const kfmt = (n: number): string =>
  Math.abs(n) >= 999.5 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`;

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
  booked: number; // app-side cash view for the same month
  lastTxn: string;
  hasBank: boolean;
}

const monthName = (i: number): string =>
  new Date(2026, i, 1).toLocaleDateString("en-US", { month: "long" });

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

  // ---- Bank truth: every Eastern statement line. The card's own ledger
  // (capone) is the detail behind the payoffs, not bank cash — never here.
  const bankRows: BankRow[] = [];
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
    bankRows.push(...batch);
    if (batch.length < PAGE) break;
  }

  if (bankRows.length === 0) {
    return (
      <>
        <Header title="Finances" backHref="/command-center" />
        <div className="p-4 sm:p-6">
          <FinanceTabs current="overview" />
          <div className="pt-4 text-sm text-muted-foreground">No bank statements loaded yet.</div>
        </div>
      </>
    );
  }

  const year = Number(bankRows[bankRows.length - 1].txn_date.slice(0, 4));

  // ---- App side of the same months: what the books say went out, on the
  // cash view (/spent's exact formula). Compared against the bank below so
  // each month shows whether it ties yet.
  const bookedByMonth = new Map<string, number>();
  for (let from = 0; from < 10 * PAGE; from += PAGE) {
    const { data } = await supabase
      .from("invoices")
      .select("invoice_date, amount, paid_amount, payment_status, payment_method")
      .gte("invoice_date", `${year}-01-01`)
      .lte("invoice_date", `${year}-12-31`)
      .eq("payment_status", "paid")
      .order("invoice_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    const batch = data ?? [];
    for (const r of batch) {
      if (r.payment_method === "capital_one" || r.payment_method === "internal") continue;
      const k = (r.invoice_date as string).slice(0, 7);
      bookedByMonth.set(k, (bookedByMonth.get(k) || 0) + Number(r.paid_amount || r.amount || 0));
    }
    if (batch.length < PAGE) break;
  }

  // ---- What's owed, both directions.
  const [{ data: arRows }, { data: apRows }] = await Promise.all([
    supabase.from("client_invoices").select("amount").eq("status", "sent"),
    supabase.from("invoices").select("amount, paid_amount").neq("payment_status", "paid"),
  ]);
  const arTotal = (arRows ?? []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const arCount = (arRows ?? []).length;
  const apTotal = (apRows ?? []).reduce((s, r) => s + Number(r.amount || 0) - Number(r.paid_amount || 0), 0);
  const apCount = (apRows ?? []).length;

  // ---- All 12 months of the year, bank data or not, so the whole year is
  // always on screen.
  const months: MonthAgg[] = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    return {
      key,
      label: monthName(i),
      moneyIn: 0,
      moneyOut: 0,
      payroll: 0,
      cardPayoff: 0,
      checks: 0,
      other: 0,
      booked: bookedByMonth.get(key) || 0,
      lastTxn: "",
      hasBank: false,
    };
  });
  const byKey = new Map(months.map(m => [m.key, m]));
  for (const r of bankRows) {
    const m = byKey.get(r.txn_date.slice(0, 7));
    if (!m) continue;
    m.hasBank = true;
    if (r.txn_date > m.lastTxn) m.lastTxn = r.txn_date;
    const amt = Number(r.amount || 0);
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

  const bankMonths = months.filter(m => m.hasBank);
  const latest = bankMonths[bankMonths.length - 1];
  const selected = months.find(m => m.key === params.m && m.hasBank) ?? latest;
  const kept = selected.moneyIn - selected.moneyOut;

  const monthEndDay = (m: MonthAgg): number =>
    new Date(Number(m.key.slice(0, 4)), Number(m.key.slice(5, 7)), 0).getDate();
  const isPartial = (m: MonthAgg): boolean =>
    m.hasBank && Number(m.lastTxn.slice(8, 10)) < monthEndDay(m);

  const ytdIn = bankMonths.reduce((s, m) => s + m.moneyIn, 0);
  const ytdOut = bankMonths.reduce((s, m) => s + m.moneyOut, 0);
  const ytdKept = ytdIn - ytdOut;

  const maxBar = Math.max(...months.map(m => Math.max(m.moneyIn, m.moneyOut)), 1);

  // Reconciliation per month: books (cash view + card payoffs) vs bank out.
  const recon = months.map(m => {
    const books = m.booked + m.cardPayoff;
    const gap = books - m.moneyOut;
    const status: "tied" | "gap" | "pending" | "future" = !m.hasBank
      ? "future"
      : isPartial(m)
        ? "pending"
        : Math.abs(gap) < 1
          ? "tied"
          : "gap";
    return { m, books, gap, status };
  });

  const OUT_PIECES = [
    { label: "Payroll", sub: "ADP — wages, taxes, fees", value: selected.payroll, dot: "bg-lime-500" },
    { label: "Checks", sub: "subs and vendors", value: selected.checks, dot: "bg-violet-500" },
    { label: "Card payoff", sub: "Capital One Visa + Amex", value: selected.cardPayoff, dot: "bg-stone-400" },
    { label: "Direct payments", sub: "ACH, debit card, insurance, fees", value: selected.other, dot: "bg-sky-500" },
  ].sort((a, b) => b.value - a.value);
  const maxPiece = OUT_PIECES[0]?.value || 1;

  const spentMonthOffset = (key: string): number => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    return (Number(key.slice(0, 4)) - now.getFullYear()) * 12 + (Number(key.slice(5, 7)) - 1 - now.getMonth());
  };

  return (
    <>
      <Header title="Finances" backHref="/command-center" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        <FinanceTabs current="overview" />

        {/* Month switcher — the year chart's bars link too, but these are the
            buttons Jorge reaches for. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {bankMonths.map(m => (
            <Link
              key={m.key}
              href={`/money?m=${m.key}`}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                m.key === selected.key
                  ? "bg-background text-foreground shadow-sm border font-semibold"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label.slice(0, 3)}
            </Link>
          ))}
        </div>

        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lg font-semibold">{year}</div>
            <div className="text-xs text-muted-foreground">
              Every dollar from the Eastern Bank statements
              {(() => {
                const lastTied = [...recon].reverse().find(r => r.status === "tied");
                return lastTied ? <> — {lastTied.m.label} ties the bank to the penny</> : null;
              })()}
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground text-right leading-relaxed hidden sm:block">
            The rhythm: every week everything gets booked in the app.<br />
            Once a month the statement loads and the month locks to the penny.
          </div>
        </div>

        {/* ---- Year headline: five numbers that ARE the business ---- */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Came in · year</div>
            <div className="text-2xl xl:text-3xl font-bold tabular-nums mt-1 text-emerald-500">{fmt(ytdIn)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">client deposits into the bank</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Went out · year</div>
            <div className="text-2xl xl:text-3xl font-bold tabular-nums mt-1 text-amber-500">{fmt(ytdOut)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">every payment that cleared</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Kept · year</div>
            <div className={`text-2xl xl:text-3xl font-bold tabular-nums mt-1 ${ytdKept >= 0 ? "text-foreground" : "text-red-400"}`}>
              {fmt(ytdKept)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">stayed in the bank</div>
          </div>
          <Link href="/payments" className="rounded-lg border bg-card p-4 hover:bg-muted/40 transition-colors">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Owed to us</div>
            <div className="text-2xl xl:text-3xl font-bold tabular-nums mt-1 text-sky-400">{fmt(arTotal)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{arCount} invoice{arCount === 1 ? "" : "s"} out to clients →</div>
          </Link>
          <Link href="/invoices?tab=unpaid" className="rounded-lg border bg-card p-4 hover:bg-muted/40 transition-colors">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">We owe</div>
            <div className="text-2xl xl:text-3xl font-bold tabular-nums mt-1 text-red-400">{fmt(apTotal)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{apCount} open bill{apCount === 1 ? "" : "s"} →</div>
          </Link>
        </div>

        {/* ---- The whole year, wall to wall ---- */}
        <div className="rounded-lg border bg-card p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold">The year, month by month</h2>
            <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500/80" /> came in</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500/80" /> went out</span>
              <span>tap a month to open it below</span>
            </div>
          </div>
          <div className="mt-4 flex items-end gap-1.5 sm:gap-3">
            {months.map(m => {
              const net = m.moneyIn - m.moneyOut;
              const inPx = m.hasBank ? Math.max(Math.round((m.moneyIn / maxBar) * 160), 4) : 2;
              const outPx = m.hasBank ? Math.max(Math.round((m.moneyOut / maxBar) * 160), 4) : 2;
              const active = m.key === selected.key;
              const body = (
                <>
                  <span
                    className={`text-[10px] leading-none tabular-nums font-medium ${
                      !m.hasBank ? "text-transparent" : net >= 0 ? "text-emerald-500" : "text-red-400"
                    }`}
                  >
                    {net >= 0 ? "+" : "−"}{kfmt(Math.abs(net))}
                  </span>
                  <div className="w-full flex items-end justify-center gap-[2px] sm:gap-1">
                    <div
                      className={`w-[42%] max-w-[26px] rounded-t-[4px] ${m.hasBank ? "bg-emerald-500/80" : "bg-muted"}`}
                      style={{ height: `${inPx}px` }}
                    />
                    <div
                      className={`w-[42%] max-w-[26px] rounded-t-[4px] ${m.hasBank ? "bg-amber-500/80" : "bg-muted"}`}
                      style={{ height: `${outPx}px` }}
                    />
                  </div>
                  <span
                    className={`text-[10px] leading-none pt-0.5 ${
                      active ? "text-foreground font-semibold" : m.hasBank ? "text-muted-foreground" : "text-muted-foreground/40"
                    }`}
                  >
                    {m.label.slice(0, 3)}
                  </span>
                </>
              );
              const cls = `flex-1 min-w-0 flex flex-col items-center justify-end gap-1 rounded-md pt-1 pb-1.5 ${
                active ? "bg-muted/60" : m.hasBank ? "hover:bg-muted/40" : ""
              }`;
              return m.hasBank ? (
                <Link key={m.key} href={`/money?m=${m.key}`} title={`${m.label}: in ${fmt(m.moneyIn)}, out ${fmt(m.moneyOut)}`} className={cls}>
                  {body}
                </Link>
              ) : (
                <div key={m.key} title={`${m.label}: statement not loaded yet`} className={cls}>
                  {body}
                </div>
              );
            })}
          </div>
        </div>

        {/* ---- Selected month + reconciliation, side by side ---- */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <div className="rounded-lg border bg-card p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <h2 className="text-sm font-semibold">{selected.label} {year}</h2>
                {isPartial(selected) && (
                  <span className="text-[11px] text-amber-500">
                    statement loaded through {new Date(selected.lastTxn + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} — not the full month yet
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Came in</div>
                  <div className="text-lg sm:text-xl font-bold tabular-nums mt-0.5 text-emerald-500">{fmt(selected.moneyIn)}</div>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Went out</div>
                  <div className="text-lg sm:text-xl font-bold tabular-nums mt-0.5 text-amber-500">{fmt(selected.moneyOut)}</div>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Kept</div>
                  <div className={`text-lg sm:text-xl font-bold tabular-nums mt-0.5 ${kept >= 0 ? "text-foreground" : "text-red-400"}`}>{fmt(kept)}</div>
                </div>
              </div>

              <h3 className="text-[13px] font-semibold mt-5">Where {selected.label}&apos;s money went</h3>
              <div className="mt-2.5 flex flex-col gap-2.5">
                {OUT_PIECES.filter(p => p.value > 0).map(p => (
                  <div key={p.label}>
                    <div className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${p.dot}`} />
                        <span className="font-medium">{p.label}</span>
                        <span className="text-muted-foreground truncate hidden sm:inline">· {p.sub}</span>
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
              <div className="mt-4 flex items-center gap-4">
                <Link href={`/spent?range=month&offset=${spentMonthOffset(selected.key)}`} className="text-[12px] font-medium text-amber-500">
                  Every transaction →
                </Link>
                <Link href={`/payments?range=month&offset=${spentMonthOffset(selected.key)}`} className="text-[12px] font-medium text-amber-500">
                  Every payment received →
                </Link>
              </div>
            </div>
          </div>

          {/* Books vs bank — the reconciliation ledger, month by month */}
          <div className="rounded-lg border bg-card p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Books vs bank</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              When a month&apos;s books match its statement, it locks. Gaps are spending on the statement not booked in the app yet.
            </p>
            <div className="mt-3 flex flex-col">
              {recon.map(({ m, gap, status }) => (
                <div
                  key={m.key}
                  className={`flex items-center justify-between gap-2 py-1.5 border-b border-border/40 last:border-b-0 text-[12.5px] ${
                    status === "future" ? "opacity-40" : ""
                  }`}
                >
                  <span className={m.key === selected.key ? "font-semibold" : ""}>{m.label}</span>
                  {status === "tied" && (
                    <span className="inline-flex items-center gap-1 text-emerald-500 font-medium tabular-nums">
                      to the penny ✓
                    </span>
                  )}
                  {status === "gap" && (
                    <Link
                      href={`/money?m=${m.key}`}
                      className="inline-flex items-center gap-1 text-amber-500 font-medium tabular-nums hover:underline"
                      title={`The app has booked ${fmt(Math.abs(gap))} ${gap < 0 ? "less" : "more"} than the statement shows`}
                    >
                      {gap < 0 ? `${fmt(Math.abs(gap))} to book` : `${fmt(gap)} over`}
                    </Link>
                  )}
                  {status === "pending" && <span className="text-muted-foreground">statement pending</span>}
                  {status === "future" && <span className="text-muted-foreground">—</span>}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
              Weekly close puts everything in the books. When the next statement loads, unclear payments roll forward and the month ties out.
            </p>
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground leading-relaxed max-w-3xl">
          <span className="text-foreground">Came in</span> is client money hitting the bank.{" "}
          <span className="text-foreground">Went out</span> is every payment that cleared.{" "}
          <span className="text-foreground">Kept</span> is what stayed. What each <em>job</em> made lives on the project pages —
          this page is the company&apos;s wallet.
        </div>
      </div>
    </>
  );
}
