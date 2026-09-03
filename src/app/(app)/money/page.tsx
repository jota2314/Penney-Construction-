import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { FinanceTabs } from "@/components/finances/finance-tabs";

export const metadata: Metadata = { title: "Finances | Penney Construction" };

// The company's financial dashboard, built around one rhythm: every week the
// office books everything into the app; once a month the statement loads and
// the month reconciles — payments that didn't clear roll forward. Months with
// a statement show BANK numbers (the statement's own totals, can't drift).
// The current month shows BOOKS numbers until its statement lands, clearly
// labeled. Below the year: who we owe, and who owes us, by name.

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
  bookedOut: number; // app-side cash spend booked in this month
  bookedIn: number; // client payments recorded in this month
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

  const year = bankRows.length ? Number(bankRows[bankRows.length - 1].txn_date.slice(0, 4)) : new Date().getFullYear();

  // ---- Books, both directions, by month: what the app has recorded. For
  // statement months this is the reconciliation check; for the current month
  // it IS the display until the statement lands.
  const bookedOutByMonth = new Map<string, number>();
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
      bookedOutByMonth.set(k, (bookedOutByMonth.get(k) || 0) + Number(r.paid_amount || r.amount || 0));
    }
    if (batch.length < PAGE) break;
  }
  const bookedInByMonth = new Map<string, number>();
  {
    const { data } = await supabase
      .from("payments_received")
      .select("received_date, amount")
      .gte("received_date", `${year}-01-01`)
      .lte("received_date", `${year}-12-31`)
      .limit(2000);
    for (const r of data ?? []) {
      if (!r.received_date) continue;
      const k = (r.received_date as string).slice(0, 7);
      bookedInByMonth.set(k, (bookedInByMonth.get(k) || 0) + Number(r.amount || 0));
    }
  }

  // ---- Who we owe / who owes us, by name.
  const [{ data: apRows }, { data: arRows }] = await Promise.all([
    supabase.from("invoices").select("vendor_name, amount, paid_amount, review_status, notes").neq("payment_status", "paid"),
    supabase
      .from("client_invoices")
      .select("amount, sent_to_client_at, projects(name, project_number)")
      .eq("status", "sent")
      .order("amount", { ascending: false }),
  ]);
  type ApAgg = { vendor: string; owed: number; n: number; review: boolean };
  const apByVendor = new Map<string, ApAgg>();
  let apTotal = 0;
  let apReview = 0; // parked likely-duplicates awaiting a verdict
  let apRolling = 0; // marked paid before, waiting for a statement to claim them
  for (const r of apRows ?? []) {
    const owed = Number(r.amount || 0) - Number(r.paid_amount || 0);
    if (owed <= 0) continue; // credits and already-covered rows aren't debt
    apTotal += owed;
    const rolling = (r.notes ?? "").includes("moved to Owed until its payment appears");
    if (r.review_status === "needs_review") apReview += owed;
    else if (rolling) apRolling += owed;
    // The headline and the by-vendor list are bills nobody has paid yet. A
    // bill the ledger says is paid but the reconcile couldn't match to an
    // Eastern line (card, or one check against a supplier statement) is a
    // reconciliation gap, not money we owe — it stays out of both.
    if (rolling) continue;
    const key = (r.vendor_name || "Unknown vendor").trim().replace(/\s+&\s+Millwork$/i, "").trim();
    const e = apByVendor.get(key) || { vendor: key, owed: 0, n: 0, review: false };
    e.owed += owed;
    e.n += 1;
    e.review = e.review || r.review_status === "needs_review";
    apByVendor.set(key, e);
  }
  const apTop = [...apByVendor.values()].sort((a, b) => b.owed - a.owed).slice(0, 8);
  const apOpen = apTotal - apRolling - apReview; // what we actually still have to pay
  const arTotal = (arRows ?? []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const arList = (arRows ?? []).map(r => {
    const p = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    return { name: p?.name || p?.project_number || "—", amount: Number(r.amount || 0), sent: r.sent_to_client_at as string | null };
  });

  // ---- All 12 months.
  const nowKey = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).toISOString().slice(0, 7);
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
      bookedOut: bookedOutByMonth.get(key) || 0,
      bookedIn: bookedInByMonth.get(key) || 0,
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
  const latestBank = bankMonths[bankMonths.length - 1];
  // A "books month" has app activity but no statement yet — the current month.
  const hasBooks = (m: MonthAgg) => !m.hasBank && m.key <= nowKey && (m.bookedOut > 0 || m.bookedIn > 0);
  const selectable = months.filter(m => m.hasBank || hasBooks(m));
  const defaultMonth = selectable[selectable.length - 1] ?? latestBank;
  const selected = months.find(m => m.key === params.m && (m.hasBank || hasBooks(m))) ?? defaultMonth;
  const selIsBooks = !selected.hasBank;
  const selIn = selIsBooks ? selected.bookedIn : selected.moneyIn;
  const selOut = selIsBooks ? selected.bookedOut : selected.moneyOut;
  const kept = selIn - selOut;

  const monthEndDay = (m: MonthAgg): number =>
    new Date(Number(m.key.slice(0, 4)), Number(m.key.slice(5, 7)), 0).getDate();
  // Only the NEWEST loaded month can be mid-statement; older months are
  // complete even when nothing moved on the literal last calendar day.
  const isPartial = (m: MonthAgg): boolean =>
    m.hasBank && m.key === latestBank.key && Number(m.lastTxn.slice(8, 10)) < monthEndDay(m);

  const ytdIn = bankMonths.reduce((s, m) => s + m.moneyIn, 0);
  const ytdOut = bankMonths.reduce((s, m) => s + m.moneyOut, 0);
  const ytdKept = ytdIn - ytdOut;

  const barVal = (m: MonthAgg, dir: "in" | "out") =>
    m.hasBank ? (dir === "in" ? m.moneyIn : m.moneyOut) : hasBooks(m) ? (dir === "in" ? m.bookedIn : m.bookedOut) : 0;
  const maxBar = Math.max(...months.map(m => Math.max(barVal(m, "in"), barVal(m, "out"))), 1);

  // Reconciliation panel: books (cash spend + payoffs) vs the statement.
  const recon = months.map(m => {
    const books = m.bookedOut + m.cardPayoff;
    const gap = books - m.moneyOut;
    const status: "tied" | "gap" | "pending" | "books" | "future" = m.hasBank
      ? isPartial(m)
        ? "pending"
        : Math.abs(gap) < 1
          ? "tied"
          : "gap"
      : hasBooks(m)
        ? "books"
        : "future";
    return { m, gap, status };
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
  const maxAp = apTop[0]?.owed || 1;

  return (
    <>
      <Header title="Finances" backHref="/command-center" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        <FinanceTabs current="overview" />

        {/* Month switcher — statement months plus the current books month. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {selectable.map(m => (
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
              {!m.hasBank && <span className="ml-1 text-[9px] uppercase text-amber-500">books</span>}
            </Link>
          ))}
        </div>

        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lg font-semibold">{year}</div>
            <div className="text-xs text-muted-foreground">
              Statement months come straight from Eastern Bank
              {(() => {
                const tied = recon.filter(r => r.status === "tied").length;
                return tied > 0 ? <> — {tied} month{tied === 1 ? "" : "s"} tie to the penny</> : null;
              })()}
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground text-right leading-relaxed hidden sm:block">
            The rhythm: every week everything gets booked in the app.<br />
            Once a month the statement loads and the month locks to the penny.
          </div>
        </div>

        {/* ---- Year headline ---- */}
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
            <div className="text-[11px] text-muted-foreground mt-0.5">{arList.length} invoice{arList.length === 1 ? "" : "s"} out to clients →</div>
          </Link>
          <Link href="/invoices?tab=unpaid" className="rounded-lg border bg-card p-4 hover:bg-muted/40 transition-colors">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">We owe</div>
            <div className="text-2xl xl:text-3xl font-bold tabular-nums mt-1 text-red-400">{fmt(apOpen)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {apRolling > 0 ? `${fmt(apRolling)} paid per ledger, not matched to a statement yet` : "open bills, nothing paid on them yet"}
            </div>
          </Link>
        </div>

        {/* ---- The whole year ---- */}
        <div className="rounded-lg border bg-card p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold">The year, month by month</h2>
            <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500/80" /> came in</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500/80" /> went out</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500/30" /> books, statement pending</span>
            </div>
          </div>
          <div className="mt-4 flex items-end gap-1.5 sm:gap-3">
            {months.map(m => {
              const books = hasBooks(m);
              const active = m.hasBank || books;
              const vIn = barVal(m, "in");
              const vOut = barVal(m, "out");
              const net = vIn - vOut;
              const inPx = active ? Math.max(Math.round((vIn / maxBar) * 160), 4) : 2;
              const outPx = active ? Math.max(Math.round((vOut / maxBar) * 160), 4) : 2;
              const isSel = m.key === selected.key;
              const body = (
                <>
                  <span
                    className={`text-[10px] leading-none tabular-nums font-medium ${
                      !active ? "text-transparent" : books ? "text-muted-foreground" : net >= 0 ? "text-emerald-500" : "text-red-400"
                    }`}
                  >
                    {net >= 0 ? "+" : "−"}{kfmt(Math.abs(net))}
                  </span>
                  <div className="w-full flex items-end justify-center gap-[2px] sm:gap-1">
                    <div
                      className={`w-[42%] max-w-[26px] rounded-t-[4px] ${
                        m.hasBank ? "bg-emerald-500/80" : books ? "bg-emerald-500/30" : "bg-muted"
                      }`}
                      style={{ height: `${inPx}px` }}
                    />
                    <div
                      className={`w-[42%] max-w-[26px] rounded-t-[4px] ${
                        m.hasBank ? "bg-amber-500/80" : books ? "bg-amber-500/30" : "bg-muted"
                      }`}
                      style={{ height: `${outPx}px` }}
                    />
                  </div>
                  <span
                    className={`text-[10px] leading-none pt-0.5 ${
                      isSel ? "text-foreground font-semibold" : active ? "text-muted-foreground" : "text-muted-foreground/40"
                    }`}
                  >
                    {m.label.slice(0, 3)}
                  </span>
                </>
              );
              const cls = `flex-1 min-w-0 flex flex-col items-center justify-end gap-1 rounded-md pt-1 pb-1.5 ${
                isSel ? "bg-muted/60" : active ? "hover:bg-muted/40" : ""
              }`;
              return active ? (
                <Link
                  key={m.key}
                  href={`/money?m=${m.key}`}
                  title={`${m.label}: in ${fmt(vIn)}, out ${fmt(vOut)}${books ? " (books — statement pending)" : ""}`}
                  className={cls}
                >
                  {body}
                </Link>
              ) : (
                <div key={m.key} title={`${m.label}: no activity yet`} className={cls}>
                  {body}
                </div>
              );
            })}
          </div>
        </div>

        {/* ---- Selected month + reconciliation ---- */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h2 className="text-sm font-semibold">{selected.label} {year}</h2>
              {selIsBooks && (
                <span className="text-[11px] text-amber-500">
                  from the books — the statement isn&apos;t in yet; this month reconciles when it loads
                </span>
              )}
              {isPartial(selected) && (
                <span className="text-[11px] text-amber-500">
                  statement loaded through {new Date(selected.lastTxn + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} — not the full month yet
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="rounded-md bg-muted/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Came in</div>
                <div className="text-lg sm:text-xl font-bold tabular-nums mt-0.5 text-emerald-500">{fmt(selIn)}</div>
              </div>
              <div className="rounded-md bg-muted/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Went out</div>
                <div className="text-lg sm:text-xl font-bold tabular-nums mt-0.5 text-amber-500">{fmt(selOut)}</div>
              </div>
              <div className="rounded-md bg-muted/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{kept >= 0 ? "Kept" : "Out of pocket"}</div>
                <div className={`text-lg sm:text-xl font-bold tabular-nums mt-0.5 ${kept >= 0 ? "text-foreground" : "text-red-400"}`}>{fmt(kept)}</div>
              </div>
            </div>

            {!selIsBooks && (
              <>
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
                            {selOut > 0 ? Math.round((p.value / selOut) * 100) : 0}%
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${p.dot}`} style={{ width: `${Math.min((p.value / maxPiece) * 100, 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {selIsBooks && (
              <p className="text-[12px] text-muted-foreground mt-4 leading-relaxed">
                These are the bills and payments booked so far this month. Card charges count when the card gets paid, and
                anything unclear rolls forward — so this number firms up the day the statement loads.
              </p>
            )}
            <div className="mt-4 flex items-center gap-4">
              <Link href={`/spent?range=month&offset=${spentMonthOffset(selected.key)}`} className="text-[12px] font-medium text-amber-500">
                Every transaction →
              </Link>
              <Link href={`/payments?range=month&offset=${spentMonthOffset(selected.key)}`} className="text-[12px] font-medium text-amber-500">
                Every payment received →
              </Link>
            </div>
          </div>

          {/* Books vs bank */}
          <div className="rounded-lg border bg-card p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Books vs bank</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              When a month&apos;s books match its statement, it locks.
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
                  {status === "tied" && <span className="text-emerald-500 font-medium tabular-nums">to the penny ✓</span>}
                  {status === "gap" && (
                    <Link href={`/money?m=${m.key}`} className="text-amber-500 font-medium tabular-nums hover:underline">
                      {gap < 0 ? `${fmt(Math.abs(gap))} to book` : `${fmt(gap)} over`}
                    </Link>
                  )}
                  {status === "pending" && <span className="text-muted-foreground">statement pending</span>}
                  {status === "books" && (
                    <Link href={`/money?m=${m.key}`} className="text-amber-500 tabular-nums hover:underline">
                      books: {fmt(m.bookedOut)} out
                    </Link>
                  )}
                  {status === "future" && <span className="text-muted-foreground">—</span>}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
              Weekly close puts everything in the books. When the next statement loads, unclear payments roll forward and the month ties out.
            </p>
          </div>
        </div>

        {/* ---- Who we owe / who owes us ---- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Who we owe</h2>
              <span className="text-[12px] font-semibold tabular-nums text-red-400">{fmt(apOpen)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Bills nobody has paid yet.
              {apRolling > 0 && <> Not counted: {fmt(apRolling)} the ledger shows paid but no statement line has claimed.</>}
              {apReview > 0 && <> {fmt(apReview)} is possible duplicates under review.</>}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {apTop.map(v => (
                <div key={v.vendor}>
                  <div className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="font-medium truncate">
                      {v.vendor}
                      <span className="text-muted-foreground font-normal"> · {v.n} bill{v.n === 1 ? "" : "s"}</span>
                      {v.review && <span className="ml-1.5 text-[9.5px] uppercase text-amber-500 font-semibold">check</span>}
                    </span>
                    <span className="tabular-nums font-semibold shrink-0">{fmt(v.owed)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-red-400/70" style={{ width: `${Math.min((v.owed / maxAp) * 100, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <Link href="/invoices?tab=unpaid" className="mt-3 inline-block text-[12px] font-medium text-amber-500">
              All open bills →
            </Link>
          </div>

          <div className="rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Who owes us</h2>
              <span className="text-[12px] font-semibold tabular-nums text-sky-400">{fmt(arTotal)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Invoices sent, waiting on the client.</p>
            <div className="mt-3 flex flex-col">
              {arList.length === 0 ? (
                <div className="text-[12.5px] text-muted-foreground py-2">Nothing outstanding — everything billed is paid.</div>
              ) : (
                arList.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40 last:border-b-0 text-[12.5px]">
                    <span className="truncate">
                      {r.name}
                      {r.sent && (
                        <span className="text-muted-foreground"> · sent {new Date(r.sent).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      )}
                    </span>
                    <span className="tabular-nums font-semibold shrink-0">{fmt(r.amount)}</span>
                  </div>
                ))
              )}
            </div>
            <Link href="/payments" className="mt-3 inline-block text-[12px] font-medium text-amber-500">
              All payments received →
            </Link>
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
