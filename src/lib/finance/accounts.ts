// The chart of accounts as the app sees it.
//
// `accounts` (migration 00136) is the persisted chart. Every bill and every
// bank statement line can carry an `account_id`; when a row has none yet,
// the resolvers below fall back to the same rulebook the QuickBooks push
// uses (spend-category.ts), so a page never shows "Uncategorized" for a
// row the rules can place. Writers stamp the account at write time; the
// Books page's backfill fills history.
//
// Pure helpers live here; anything touching Supabase takes the client in.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SPEND_CATEGORIES, spendCategoryFor, type SpendCategoryInput } from "@/lib/finance/spend-category";

export type AccountType = "income" | "cogs" | "expense" | "asset" | "liability" | "equity" | "transfer";

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  qbo_name: string | null;
  spend_key: string | null;
  bank_key: string | null;
  is_active: boolean;
  is_system: boolean;
  sort_order: number;
  notes: string | null;
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  income: "Income",
  cogs: "Job costs",
  expense: "Overhead",
  asset: "Assets",
  liability: "Liabilities",
  equity: "Owner",
  transfer: "Transfers",
};

export const ACCOUNT_TYPE_ORDER: AccountType[] = ["income", "cogs", "expense", "asset", "liability", "equity", "transfer"];

/** True when a movement in this account is part of profit & loss. */
export const isPnlType = (t: AccountType): boolean => t === "income" || t === "cogs" || t === "expense";

export interface AccountIndex {
  all: Account[];
  byId: Map<string, Account>;
  bySpendKey: Map<string, Account>;
  byBankKey: Map<string, Account>;
  byCode: Map<string, Account>;
  /** 9900 — the row the rules could not place. */
  uncategorized: Account;
}

export async function loadAccounts(supabase: SupabaseClient): Promise<AccountIndex> {
  const { data } = await supabase
    .from("accounts")
    .select("id, code, name, type, qbo_name, spend_key, bank_key, is_active, is_system, sort_order, notes")
    .order("sort_order", { ascending: true });
  const all = (data ?? []) as Account[];
  const byId = new Map(all.map((a) => [a.id, a]));
  const bySpendKey = new Map(all.filter((a) => a.spend_key).map((a) => [a.spend_key as string, a]));
  const byBankKey = new Map(all.filter((a) => a.bank_key).map((a) => [a.bank_key as string, a]));
  const byCode = new Map(all.map((a) => [a.code, a]));
  const uncategorized =
    byCode.get("9900") ??
    ({
      id: "",
      code: "9900",
      name: "Uncategorized",
      type: "expense",
      qbo_name: null,
      spend_key: null,
      bank_key: null,
      is_active: true,
      is_system: true,
      sort_order: 999,
      notes: null,
    } as Account);
  return { all, byId, bySpendKey, byBankKey, byCode, uncategorized };
}

export interface InvoiceAccountInput extends SpendCategoryInput {
  account_id?: string | null;
  is_capex?: boolean | null;
}

/**
 * The account a bill books to: what was stored, else a capital purchase,
 * else the rulebook. Never null — the rulebook always lands somewhere.
 */
export function resolveInvoiceAccount(inv: InvoiceAccountInput, idx: AccountIndex): Account {
  if (inv.account_id) {
    const stored = idx.byId.get(inv.account_id);
    if (stored) return stored;
  }
  if (inv.is_capex) return idx.byCode.get("1500") ?? idx.uncategorized;
  const cat = spendCategoryFor(inv);
  return idx.bySpendKey.get(cat.key) ?? idx.uncategorized;
}

/** The rulebook's account id for a bill about to be written (null if the chart isn't loaded). */
export function accountIdForNewInvoice(inv: InvoiceAccountInput, idx: AccountIndex): string | null {
  const a = resolveInvoiceAccount(inv, idx);
  return a.id || null;
}

export interface BankAccountInput {
  account_id?: string | null;
  category_key?: string | null;
  direction: "debit" | "credit" | string;
  source?: string | null;
  description?: string | null;
}

/**
 * The account a statement line books to: stored, else the account of the
 * bill it was matched to (passed in), else its legacy category key, else a
 * few things the description alone can say, else Uncategorized.
 */
export function resolveBankAccount(
  row: BankAccountInput,
  idx: AccountIndex,
  matchedInvoiceAccount?: Account | null,
): Account {
  if (row.account_id) {
    const stored = idx.byId.get(row.account_id);
    if (stored) return stored;
  }
  if (matchedInvoiceAccount) return matchedInvoiceAccount;
  if (row.category_key) {
    const byKey = idx.byBankKey.get(row.category_key);
    if (byKey) return byKey;
  }
  const d = row.description ?? "";
  if (/capital one.*(pmt|payment)|amex.*(pmt|payment)/i.test(d)) return idx.byCode.get("9000") ?? idx.uncategorized;
  if (row.direction === "credit") {
    if ((row.source ?? "").startsWith("eastern")) return idx.byCode.get("4000") ?? idx.uncategorized;
    if (/^payment/i.test(d)) return idx.byCode.get("9000") ?? idx.uncategorized;
    return idx.byCode.get("5100") ?? idx.uncategorized;
  }
  if (/adp (tax|fee)/i.test(d)) return idx.byCode.get("5250") ?? idx.uncategorized;
  if (/adp wage/i.test(d)) return idx.byCode.get("5200") ?? idx.uncategorized;
  return idx.uncategorized;
}

/** Legacy display bucket for an account, for pages still drawn in SPEND_CATEGORIES colors. */
export function spendCategoryForAccount(a: Account) {
  return (a.spend_key && SPEND_CATEGORIES[a.spend_key]) || null;
}
