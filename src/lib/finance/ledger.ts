// Cash-basis books built from the bank ledger.
//
// The statement line is the unit of truth: every dollar that moved through
// Eastern or the Capital One card is one row in bank_transactions. Its
// account comes from (in order) the stored account_id, the bill it was
// matched to, its legacy category key, the description. From that we get:
//
//   P&L by month      income / job costs / overhead, transfers and asset
//                     purchases excluded. Card CHARGES count as expenses
//                     when charged (that is how cash-basis taxpayers treat
//                     credit cards); the PAYOFF is a transfer.
//   Trial balance     debits and credits per account for a period — what a
//                     CPA imports.
//   1099 report       what was paid by check/ACH to each sub in a year.
//                     Card payments are excluded on purpose: the card
//                     processor reports those on a 1099-K, not us.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadAccounts,
  resolveBankAccount,
  resolveInvoiceAccount,
  isPnlType,
  type Account,
  type AccountIndex,
  type AccountType,
} from "@/lib/finance/accounts";

const PAGE = 1000;

export interface LedgerLine {
  id: string;
  date: string;
  description: string | null;
  amount: number;
  direction: "debit" | "credit";
  source: string | null;
  account: Account;
  /** True when no stored account and no matched bill — the rules guessed. */
  inferred: boolean;
  matched_invoice_id: string | null;
  vendor_name: string | null;
  project_id: string | null;
  check_number: string | null;
}

interface BankRow {
  id: string;
  txn_date: string;
  description: string | null;
  amount: number;
  direction: "debit" | "credit";
  source: string | null;
  check_number: string | null;
  category_key: string | null;
  account_id: string | null;
  project_id: string | null;
  vendor_name: string | null;
  match_status: string | null;
}

interface MatchRow {
  bank_transaction_id: string;
  invoice_id: string | null;
  amount_applied: number | null;
}

interface InvoiceLite {
  id: string;
  vendor_name: string | null;
  vendor_type: string | null;
  trade: string | null;
  description: string | null;
  account_id: string | null;
  is_capex: boolean | null;
  subcontractor_id: string | null;
  project_id: string | null;
  projects: { is_overhead: boolean | null } | { is_overhead: boolean | null }[] | null;
}

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data } = await fetchPage(from, from + PAGE - 1);
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/**
 * Every statement line in [start, end] with its resolved account.
 */
export async function loadLedger(
  supabase: SupabaseClient,
  start: string,
  end: string,
  idx?: AccountIndex,
): Promise<{ lines: LedgerLine[]; accounts: AccountIndex }> {
  const accounts = idx ?? (await loadAccounts(supabase));

  const bank = await pageAll<BankRow>((from, to) =>
    supabase
      .from("bank_transactions")
      .select("id, txn_date, description, amount, direction, source, check_number, category_key, account_id, project_id, vendor_name, match_status")
      .gte("txn_date", start)
      .lte("txn_date", end)
      .order("txn_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (bank.length === 0) return { lines: [], accounts };

  // Matched bills, for the lines that carry no account of their own.
  const needMatch = bank.filter((b) => !b.account_id).map((b) => b.id);
  const matchByBank = new Map<string, MatchRow>();
  const invoiceIds = new Set<string>();
  for (let i = 0; i < needMatch.length; i += 500) {
    const slice = needMatch.slice(i, i + 500);
    const { data } = await supabase
      .from("bank_transaction_matches")
      .select("bank_transaction_id, invoice_id, amount_applied")
      .in("bank_transaction_id", slice);
    for (const m of (data ?? []) as MatchRow[]) {
      if (!m.invoice_id) continue;
      // First match wins for the account; a split check is one vendor anyway.
      if (!matchByBank.has(m.bank_transaction_id)) matchByBank.set(m.bank_transaction_id, m);
      invoiceIds.add(m.invoice_id);
    }
  }
  const invoices = new Map<string, InvoiceLite>();
  const ids = [...invoiceIds];
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await supabase
      .from("invoices")
      .select("id, vendor_name, vendor_type, trade, description, account_id, is_capex, subcontractor_id, project_id, projects(is_overhead)")
      .in("id", ids.slice(i, i + 500));
    for (const inv of (data ?? []) as unknown as InvoiceLite[]) invoices.set(inv.id, inv);
  }

  const lines: LedgerLine[] = bank.map((b) => {
    const m = matchByBank.get(b.id);
    const inv = m?.invoice_id ? invoices.get(m.invoice_id) ?? null : null;
    const invAccount = inv
      ? resolveInvoiceAccount(
          {
            account_id: inv.account_id,
            is_capex: inv.is_capex,
            vendorName: inv.vendor_name,
            vendorType: inv.vendor_type,
            trade: inv.trade,
            description: inv.description,
            isOverhead: !inv.project_id || Boolean((Array.isArray(inv.projects) ? inv.projects[0] : inv.projects)?.is_overhead),
          },
          accounts,
        )
      : null;
    const account = resolveBankAccount(b, accounts, invAccount);
    return {
      id: b.id,
      date: b.txn_date,
      description: b.description,
      amount: Number(b.amount) || 0,
      direction: b.direction,
      source: b.source,
      account,
      inferred: !b.account_id && !invAccount,
      matched_invoice_id: m?.invoice_id ?? null,
      vendor_name: b.vendor_name ?? inv?.vendor_name ?? null,
      project_id: b.project_id ?? inv?.project_id ?? null,
      check_number: b.check_number,
    };
  });

  return { lines, accounts };
}

/** Signed P&L effect of a line: income credits +, expense debits −, refunds +. */
export function pnlEffect(line: LedgerLine): number {
  if (!isPnlType(line.account.type)) return 0;
  const sign = line.direction === "credit" ? 1 : -1;
  if (line.account.type === "income") return sign * line.amount;
  // cost accounts: a debit is spend (negative to profit), a credit is a refund
  return sign * line.amount;
}

export interface PnlRow {
  account: Account;
  byMonth: number[]; // 12 entries, expense months positive numbers
  total: number;
}

export interface PnlReport {
  year: number;
  months: string[]; // "2026-01" ...
  income: PnlRow[];
  cogs: PnlRow[];
  expense: PnlRow[];
  totals: {
    income: number[];
    cogs: number[];
    expense: number[];
    grossProfit: number[];
    netProfit: number[];
  };
  /** Money that moved but is not P&L: transfers, assets, loans, draws. */
  nonPnl: PnlRow[];
  uncategorizedCount: number;
  inferredCount: number;
}

export function buildPnl(lines: LedgerLine[], year: number, accounts: AccountIndex): PnlReport {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const rows = new Map<string, PnlRow>();
  const row = (a: Account): PnlRow => {
    let r = rows.get(a.id);
    if (!r) {
      r = { account: a, byMonth: Array(12).fill(0), total: 0 };
      rows.set(a.id, r);
    }
    return r;
  };
  let uncategorizedCount = 0;
  let inferredCount = 0;
  for (const l of lines) {
    if (!l.date.startsWith(String(year))) continue;
    const mi = Number(l.date.slice(5, 7)) - 1;
    if (mi < 0 || mi > 11) continue;
    const r = row(l.account);
    // Store the natural magnitude: income as received, costs as spent
    // (credits against a cost account reduce it — a refund).
    const v = l.account.type === "income"
      ? (l.direction === "credit" ? l.amount : -l.amount)
      : (l.direction === "debit" ? l.amount : -l.amount);
    r.byMonth[mi] += v;
    r.total += v;
    if (l.account.id === accounts.uncategorized.id) uncategorizedCount += 1;
    if (l.inferred) inferredCount += 1;
  }
  const ofType = (t: AccountType) =>
    [...rows.values()].filter((r) => r.account.type === t).sort((a, b) => a.account.sort_order - b.account.sort_order);
  const sum = (rs: PnlRow[]) => months.map((_, i) => rs.reduce((s, r) => s + r.byMonth[i], 0));
  const income = ofType("income");
  const cogs = ofType("cogs");
  const expense = ofType("expense");
  const tIncome = sum(income);
  const tCogs = sum(cogs);
  const tExpense = sum(expense);
  const grossProfit = months.map((_, i) => tIncome[i] - tCogs[i]);
  const netProfit = months.map((_, i) => grossProfit[i] - tExpense[i]);
  const nonPnl = [...rows.values()]
    .filter((r) => !isPnlType(r.account.type))
    .sort((a, b) => a.account.sort_order - b.account.sort_order);
  return {
    year,
    months,
    income,
    cogs,
    expense,
    totals: { income: tIncome, cogs: tCogs, expense: tExpense, grossProfit, netProfit },
    nonPnl,
    uncategorizedCount,
    inferredCount,
  };
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: AccountType;
  qbo_name: string | null;
  debits: number;
  credits: number;
  count: number;
}

/** Debits and credits per account for the lines given, in chart order. */
export function buildTrialBalance(lines: LedgerLine[]): TrialBalanceRow[] {
  const rows = new Map<string, TrialBalanceRow & { sort: number }>();
  for (const l of lines) {
    const a = l.account;
    let r = rows.get(a.id);
    if (!r) {
      r = { code: a.code, name: a.name, type: a.type, qbo_name: a.qbo_name, debits: 0, credits: 0, count: 0, sort: a.sort_order };
      rows.set(a.id, r);
    }
    if (l.direction === "debit") r.debits += l.amount;
    else r.credits += l.amount;
    r.count += 1;
  }
  return [...rows.values()]
    .sort((a, b) => a.sort - b.sort)
    .map(({ code, name, type, qbo_name, debits, credits, count }) => ({ code, name, type, qbo_name, debits, credits, count }));
}

export interface NineNineRow {
  vendor: string;
  subcontractor_id: string | null;
  legal_name: string | null;
  w9_on_file: boolean;
  is_1099_eligible: boolean;
  tax_id_last4: string | null;
  paid: number;
  payments: number;
  /** Paid by card too — shown for context, NOT in `paid`. */
  paid_by_card: number;
}

/** 2026 onward: $2,000 (One Big Beautiful Bill Act). Before: $600. */
export const nineNineThreshold = (year: number): number => (year >= 2026 ? 2000 : 600);

/**
 * Payments to subs by check/ACH out of Eastern for a calendar year.
 * Sub = the matched bill's vendor is typed subcontractor or books to 5000.
 */
export async function build1099(
  supabase: SupabaseClient,
  year: number,
): Promise<{ rows: NineNineRow[]; threshold: number }> {
  const { lines } = await loadLedger(supabase, `${year}-01-01`, `${year}-12-31`);
  const subLines = lines.filter(
    (l) => l.direction === "debit" && l.account.code === "5000",
  );
  const invIds = [...new Set(subLines.map((l) => l.matched_invoice_id).filter((x): x is string => Boolean(x)))];
  const invVendor = new Map<string, { vendor_name: string | null; subcontractor_id: string | null; vendor_type: string | null }>();
  for (let i = 0; i < invIds.length; i += 500) {
    const { data } = await supabase
      .from("invoices")
      .select("id, vendor_name, subcontractor_id, vendor_type")
      .in("id", invIds.slice(i, i + 500));
    for (const r of data ?? []) invVendor.set(r.id, r);
  }
  const { data: subs } = await supabase
    .from("subcontractors")
    .select("id, company_name, legal_name, w9_on_file, is_1099_eligible, tax_id_last4");
  const subById = new Map((subs ?? []).map((s) => [s.id, s]));
  const subByName = new Map((subs ?? []).map((s) => [normalize(s.company_name), s]));

  const agg = new Map<string, NineNineRow>();
  const add = (key: string, seed: Omit<NineNineRow, "paid" | "payments" | "paid_by_card">, amount: number, byCard: boolean) => {
    let r = agg.get(key);
    if (!r) {
      r = { ...seed, paid: 0, payments: 0, paid_by_card: 0 };
      agg.set(key, r);
    }
    if (byCard) r.paid_by_card += amount;
    else {
      r.paid += amount;
      r.payments += 1;
    }
  };
  for (const l of subLines) {
    const inv = l.matched_invoice_id ? invVendor.get(l.matched_invoice_id) : null;
    const name = (inv?.vendor_name ?? l.vendor_name ?? l.description ?? "Unknown").trim();
    const sub = (inv?.subcontractor_id && subById.get(inv.subcontractor_id)) || subByName.get(normalize(name)) || null;
    const key = sub ? `sub:${sub.id}` : `name:${normalize(name)}`;
    const byCard = (l.source ?? "") === "capone";
    add(
      key,
      {
        vendor: sub?.company_name ?? name,
        subcontractor_id: sub?.id ?? null,
        legal_name: sub?.legal_name ?? null,
        w9_on_file: Boolean(sub?.w9_on_file),
        is_1099_eligible: sub ? sub.is_1099_eligible !== false : true,
        tax_id_last4: sub?.tax_id_last4 ?? null,
      },
      l.amount,
      byCard,
    );
  }
  const rows = [...agg.values()].sort((a, b) => b.paid - a.paid);
  return { rows, threshold: nineNineThreshold(year) };
}

function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(inc|llc|corp|co|ltd|the)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** CSV with proper quoting. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          if (v === null || v === undefined) return "";
          const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}
