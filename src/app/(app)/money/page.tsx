import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { FinanceTabs } from "@/components/finances/finance-tabs";
import { formatMoney } from "@/lib/money";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { summarizeRecordedCash } from "@/lib/finance/overview-cash";
import { CollectionPlanDialog } from "@/components/ceo/collection-plan-dialog";
import { publishedCollectionPlan } from "@/lib/finance/published-collection-plan";
import { getCollectionInvoices } from "@/lib/finance/collection-invoices";

export const metadata: Metadata = { title: "Finances | Penney Construction" };

// YTD uses recorded Penney cash activity through today. The separate monthly
// bank view can have an earlier cutoff and must not stand in for full YTD.

const fmt = (n: number): string => formatMoney(n || 0);
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
    const { data, error } = await supabase
      .from("bank_transactions")
      .select("txn_date, description, amount, direction, check_number, category_key")
      .like("source", "eastern%")
      .order("txn_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error("Unable to load bank activity");
    const batch = (data ?? []) as BankRow[];
    bankRows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const year = Number(today.slice(0, 4));
  const checked = <T,>(result: { data: T[] | null; error: { message: string } | null }) => { if (result.error) throw new Error("Unable to load financial records"); return result; };
  const [cashBills, cashReceipts, cardPayoffs] = await Promise.all([
    fetchAllRows((from, to) => supabase.from("invoices").select("invoice_date, amount, paid_amount, payment_status, payment_method").eq("payment_status", "paid").gte("invoice_date", `${year}-01-01`).lte("invoice_date", today).order("id").range(from, to).then(checked)),
    fetchAllRows((from, to) => supabase.from("payments_received").select("received_date, amount").gte("received_date", `${year}-01-01`).lte("received_date", today).order("id").range(from, to).then(checked)),
    fetchAllRows((from, to) => supabase.from("bank_transactions").select("txn_date, amount").eq("category_key", "card_payoff").eq("direction", "debit").gte("txn_date", `${year}-01-01`).lte("txn_date", today).order("id").range(from, to).then(checked)),
  ]);

  // ---- Books, both directions, by month: what the app has recorded. For
  // statement months this is the reconciliation check; for the current month
  // it IS the display until the statement lands.
  const bookedOutByMonth = new Map<string, number>();
  for (const row of cashBills) {
    if (!row.invoice_date || ["capital_one", "internal"].includes(row.payment_method || "")) continue;
    const key = row.invoice_date.slice(0, 7);
    bookedOutByMonth.set(key, (bookedOutByMonth.get(key) || 0) + Number(row.paid_amount || row.amount || 0));
  }
  const bookedInByMonth = new Map<string, number>();
  for (const row of cashReceipts) {
    if (!row.received_date) continue;
    const key = row.received_date.slice(0, 7);
    bookedInByMonth.set(key, (bookedInByMonth.get(key) || 0) + Number(row.amount || 0));
  }
  // ---- Who we owe / who owes us, by name.
  const [{ data: apRows }, { data: arRows }, collectionInvoices] = await Promise.all([
    supabase.from("invoices").select("vendor_name, amount, paid_amount, review_status, notes").neq("payment_status", "paid"),
    supabase
      .from("client_invoices")
      .select("amount, sent_to_client_at, projects(name, project_number)")
      .eq("status", "sent")
      .order("amount", { ascending: false }),
    getCollectionInvoices().catch(() => null),
  ]);
  type ApAgg = { vendor: string; owed: number; n: number; review: boolean };
  const apByVendor = new Map<string, ApAgg>();
  let apTotal = 0;
  let apReview = 0; // parked likely-duplicates awaiting a verdict
  let apRolling = 0; // marked paid before, waiting for a statement to claim them
  for (const r of apRows ?? []) {
    const owed = Number(r.amount || 0) - Number(r.paid_amount || 0);
    apTotal += owed;
    if (r.review_status === "needs_review") apReview += owed;
    else if ((r.notes ?? "").includes("moved to Owed until its payment appears")) apRolling += owed;
    const key = (r.vendor_name || "Unknown vendor").trim().replace(/\s+&\s+Millwork$/i, "").trim();
    const e = apByVendor.get(key) || { vendor: key, owed: 0, n: 0, review: false };
    e.owed += owed;
    e.n += 1;
    e.review = e.review || r.review_status === "needs_review";
    apByVendor.set(key, e);
  }
  const apTop = [...apByVendor.values()].sort((a, b) => b.owed - a.owed).slice(0, 8);
  const arTotal = (arRows ?? []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const arList = (arRows ?? []).map(r => {
    const p = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    return { name: p?.name || p?.project_number || "—", amount: Number(r.amount || 0), sent: r.sent_to_client_at as string | null };
  });

  // ---- All 12 months.
  const nowKey = today.slice(0, 7);
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
  const defaultMonth = selectable[selectable.length - 1] ?? months[Number(today.slice(5, 7)) - 1];
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
    m.hasBank && m.key === latestBank?.key && Number(m.lastTxn.slice(8, 10)) < monthEndDay(m);

  const cash = summarizeRecordedCash(cashReceipts, cashBills, cardPayoffs, today);
  const { received: ytdIn, spent: ytdOut, net: ytdKept } = cash;

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
              Recorded cash activity · January 1 through {today}
              {(() => {
                const tied = recon.filter(r => r.status === "tied").length;
                return tied > 0 ? <> · {tied} month{tied === 1 ? "" : "s"} with matching expense totals</> : null;
              })()}
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground text-right leading-relaxed hidden sm:block">
            Bank activity loaded through {latestBank?.lastTxn || "no imported statement"}.<br />
            Books after that date await bank reconciliation.
          </div>
        </div>

        {/* ---- Year headline ---- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <Link href="/payments?range=year&offset=0" className="@container min-w-0 rounded-lg border bg-card p-4 hover:bg-muted/40">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Received · year to date</div>
            <div className="text-[clamp(1rem,10cqi,1.875rem)] [overflow-wrap:anywhere] font-bold tabular-nums mt-1 text-emerald-500">{fmt(ytdIn)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">client payments recorded in Penney →</div>
          </Link>
          <Link href="/spent?range=year&offset=0" className="@container min-w-0 rounded-lg border bg-card p-4 hover:bg-muted/40">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Paid out · year to date</div>
            <div className="text-[clamp(1rem,10cqi,1.875rem)] [overflow-wrap:anywhere] font-bold tabular-nums mt-1 text-amber-500">{fmt(ytdOut)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">paid bills + recorded card payoffs</div>
          </Link>
          <div className="@container min-w-0 rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Net cash flow · year to date</div>
            <div className={`text-[clamp(1rem,10cqi,1.875rem)] [overflow-wrap:anywhere] font-bold tabular-nums mt-1 ${ytdKept >= 0 ? "text-foreground" : "text-red-400"}`}>
              {fmt(ytdKept)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">receipts minus recorded cash out</div>
          </div>
          <CollectionPlanDialog plan={publishedCollectionPlan} invoiceProjects={collectionInvoices} triggerClassName="@container min-w-0 rounded-lg border bg-card p-4 text-left hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Owed to us</div>
            <div className="text-[clamp(1rem,10cqi,1.875rem)] [overflow-wrap:anywhere] font-bold tabular-nums mt-1 text-sky-400">{fmt(arTotal)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">View collection plan &amp; invoices →</div>
          </CollectionPlanDialog>
          <Link href="/invoices?tab=unpaid" className="@container min-w-0 rounded-lg border bg-card p-4 hover:bg-muted/40 transition-colors">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">We owe</div>
            <div className="text-[clamp(1rem,10cqi,1.875rem)] [overflow-wrap:anywhere] font-bold tabular-nums mt-1 text-red-400">{fmt(apTotal)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {fmt(apRolling)} clears with the next statement
            </div>
          </Link>
        </div>

        <div className="rounded-xl border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <p><strong className="text-foreground">Net cash flow = receipts minus recorded cash out.</strong> It is not profit or your bank balance. It excludes your opening balance, unpaid costs, and activity not yet recorded.</p>
          <p className="mt-1">Year-to-date totals use Penney receipts and paid bills through {today}. Card charges count at payoff; internal labor placeholders are excluded so payroll is not counted twice. Paid bills are grouped by bill date, which may differ from the bank clearing date.</p>
          <p className="mt-1">Separate bank imports through {latestBank?.lastTxn || "—"}: {fmt(bankMonths.reduce((sum, month) => sum + month.moneyIn, 0))} in · {fmt(bankMonths.reduce((sum, month) => sum + month.moneyOut, 0))} out. Later recorded activity is included in the year-to-date cards above.</p>
        </div>

        {/* ---- The whole year ---- */}
        <div className="@container min-w-0 rounded-lg border bg-card p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold">Monthly bank activity & provisional books</h2>
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
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Net cash flow</div>
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
                Recorded receipts and bills marked paid through today, grouped by received date and bill date. Bank clearance and later card payoffs may still be missing.
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
          <div className="@container min-w-0 rounded-lg border bg-card p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Books vs bank</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Expense-total comparison only; a match does not verify every transaction.
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
                  {status === "tied" && <span className="text-emerald-500 font-medium tabular-nums">expense totals match</span>}
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
              Differences need reconciliation. Imported bank transactions and booked payments use different dates and may have incomplete coverage.
            </p>
          </div>
        </div>

        {/* ---- Who we owe / who owes us ---- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="@container min-w-0 rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Who we owe</h2>
              <span className="text-[12px] font-semibold tabular-nums text-red-400">{fmt(apTotal)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {fmt(apRolling)} is already-written payments waiting for the next statement to claim them
              {apReview > 0 && <>; {fmt(apReview)} is possible duplicates under review</>}.
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

          <div className="@container min-w-0 rounded-lg border bg-card p-4 sm:p-5">
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
            <CollectionPlanDialog plan={publishedCollectionPlan} invoiceProjects={collectionInvoices} triggerClassName="mt-3 inline-block text-[12px] font-medium text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                View collection plan &amp; invoices →
            </CollectionPlanDialog>
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground leading-relaxed max-w-3xl">
          The monthly chart uses imported bank transactions where available, and provisional books for months without bank data. It has a different coverage basis from the recorded year-to-date totals. Job profitability is shown separately on project pages.
        </div>
      </div>
    </>
  );
}
