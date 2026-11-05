import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { financialRows } from "@/lib/crew/load-labor-ledger";
import { assertBankPeriod, summarizeBankPeriod, type BankPeriodBounds, type BankPeriodRecord } from "./bank-period";

/** Read the selected period through the caller's authenticated permissions.
 * A failed page never becomes a zero or partial bank total. DATE columns and
 * the query bounds select posting dates; they do not prove complete statements.
 * Nested links are recorded associations, never automatic verified matches. */
export async function loadBankPeriod(bounds: BankPeriodBounds) {
  assertBankPeriod(bounds);
  const user = await requireAuth();
  if (!canSeeBoardMoney(user.profile?.role)) throw new Error("Bank activity is not available to this role.");
  const db = await createClient();
  const records = await financialRows((from, to) => db.from("bank_transactions")
    .select("id,txn_date,source,amount,direction,description,category_key,check_number,statement_file,statement_month,match_status,match_note,external_ref,bank_transaction_matches(id,invoice_id,payment_id,amount_applied,confidence)")
    .like("source", "eastern%")
    .gte("txn_date", bounds.start).lte("txn_date", bounds.end)
    .order("txn_date").order("id").range(from, to));
  // PostgREST can cap embedded children independently from parent pagination.
  // A cap-sized child array cannot establish a complete link inventory.
  if (records.some(row => (row.bank_transaction_matches?.length ?? 0) >= 1000)) {
    throw new Error("Complete saved bank link inventory unavailable.");
  }
  return summarizeBankPeriod(records as BankPeriodRecord[], bounds);
}
