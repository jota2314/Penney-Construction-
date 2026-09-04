// Stamp chart-of-accounts ids onto rows that were written without one.
//
// Server-only (service role): runs after every bill writer and behind the
// Books page's "Backfill" button. Idempotent — only rows with a null
// account_id are touched, and the account is the same one the reader
// would have inferred, so nothing on screen changes; it just becomes stored,
// editable, and exportable.

import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccounts, resolveInvoiceAccount, resolveBankAccount, type AccountIndex } from "@/lib/finance/accounts";

interface InvoiceForAssign {
  id: string;
  vendor_name: string | null;
  vendor_type: string | null;
  trade: string | null;
  description: string | null;
  account_id: string | null;
  is_capex: boolean | null;
  project_id: string | null;
  estimate_line_items: { description: string | null } | { description: string | null }[] | null;
  projects: { is_overhead: boolean | null } | { is_overhead: boolean | null }[] | null;
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Assign accounts to the given bills (skips rows that already have one). */
export async function assignAccountsToInvoices(invoiceIds: string[], idx?: AccountIndex): Promise<number> {
  if (invoiceIds.length === 0) return 0;
  const admin = createAdminClient();
  const accounts = idx ?? (await loadAccounts(admin));
  let stamped = 0;
  for (let i = 0; i < invoiceIds.length; i += 500) {
    const { data } = await admin
      .from("invoices")
      .select("id, vendor_name, vendor_type, trade, description, account_id, is_capex, project_id, estimate_line_items(description), projects(is_overhead)")
      .in("id", invoiceIds.slice(i, i + 500))
      .is("account_id", null);
    const rows = (data ?? []) as unknown as InvoiceForAssign[];
    // Group by resolved account so each account is one UPDATE … IN (…).
    const byAccount = new Map<string, string[]>();
    for (const r of rows) {
      const a = resolveInvoiceAccount(
        {
          account_id: null,
          is_capex: r.is_capex,
          vendorName: r.vendor_name,
          vendorType: r.vendor_type,
          trade: r.trade,
          description: r.description,
          lineItemText: one(r.estimate_line_items)?.description ?? null,
          isOverhead: !r.project_id || Boolean(one(r.projects)?.is_overhead),
        },
        accounts,
      );
      if (!a.id) continue;
      const arr = byAccount.get(a.id) ?? [];
      arr.push(r.id);
      byAccount.set(a.id, arr);
    }
    for (const [accountId, ids] of byAccount) {
      const { error } = await admin.from("invoices").update({ account_id: accountId }).in("id", ids);
      if (!error) stamped += ids.length;
      else console.error("[account-assign] invoices update failed", error.message);
    }
  }
  return stamped;
}

/**
 * Backfill every bill with no account, oldest first, in pages. Returns how
 * many were stamped and how many remain (0 when done).
 */
export async function backfillInvoiceAccounts(limit = 2000): Promise<{ stamped: number; remaining: number }> {
  const admin = createAdminClient();
  const accounts = await loadAccounts(admin);
  const { data } = await admin
    .from("invoices")
    .select("id")
    .is("account_id", null)
    .order("invoice_date", { ascending: true })
    .limit(limit);
  const ids = (data ?? []).map((r) => r.id as string);
  const stamped = await assignAccountsToInvoices(ids, accounts);
  const { count } = await admin.from("invoices").select("id", { count: "exact", head: true }).is("account_id", null);
  return { stamped, remaining: count ?? 0 };
}

interface BankForAssign {
  id: string;
  description: string | null;
  direction: string;
  source: string | null;
  category_key: string | null;
  account_id: string | null;
}

/**
 * Backfill bank lines with no account: matched bill's account first (so an
 * uncategorized Eastern check to Cosentino books to Subcontractors), then
 * the legacy category key, then the description rules. Lines the rules
 * cannot place stay null so the Books page can list them for a human.
 */
export async function backfillBankAccounts(limit = 2000): Promise<{ stamped: number; remaining: number }> {
  const admin = createAdminClient();
  const accounts = await loadAccounts(admin);
  const { data } = await admin
    .from("bank_transactions")
    .select("id, description, direction, source, category_key, account_id")
    .is("account_id", null)
    .order("txn_date", { ascending: true })
    .limit(limit);
  const rows = (data ?? []) as BankForAssign[];
  if (rows.length === 0) return { stamped: 0, remaining: 0 };

  const ids = rows.map((r) => r.id);
  const matchByBank = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data: matches } = await admin
      .from("bank_transaction_matches")
      .select("bank_transaction_id, invoice_id")
      .in("bank_transaction_id", ids.slice(i, i + 500));
    for (const m of matches ?? []) {
      if (m.invoice_id && !matchByBank.has(m.bank_transaction_id)) matchByBank.set(m.bank_transaction_id, m.invoice_id);
    }
  }
  const invIds = [...new Set(matchByBank.values())];
  // Make sure those bills carry an account first, then read it back.
  await assignAccountsToInvoices(invIds, accounts);
  const invAccount = new Map<string, string | null>();
  for (let i = 0; i < invIds.length; i += 500) {
    const { data: invs } = await admin.from("invoices").select("id, account_id").in("id", invIds.slice(i, i + 500));
    for (const inv of invs ?? []) invAccount.set(inv.id, inv.account_id);
  }

  const byAccount = new Map<string, string[]>();
  for (const r of rows) {
    const invId = matchByBank.get(r.id);
    const matchedAccountId = invId ? invAccount.get(invId) ?? null : null;
    const matched = matchedAccountId ? accounts.byId.get(matchedAccountId) ?? null : null;
    const a = resolveBankAccount(r, accounts, matched);
    // Leave the truly unknown alone — a null is honest, "Uncategorized" hides.
    if (!a.id || a.id === accounts.uncategorized.id) continue;
    const arr = byAccount.get(a.id) ?? [];
    arr.push(r.id);
    byAccount.set(a.id, arr);
  }
  let stamped = 0;
  for (const [accountId, rowIds] of byAccount) {
    const { error } = await admin.from("bank_transactions").update({ account_id: accountId }).in("id", rowIds);
    if (!error) stamped += rowIds.length;
    else console.error("[account-assign] bank update failed", error.message);
  }
  const { count } = await admin.from("bank_transactions").select("id", { count: "exact", head: true }).is("account_id", null);
  return { stamped, remaining: count ?? 0 };
}
