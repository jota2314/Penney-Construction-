/**
 * Rows imported from bank or card statements (bank_reconcile_*, statement
 * imports, Capital One statement reviews, reconciled checks) or from the
 * retired Drive ledger represent money that already cleared. QuickBooks sees
 * the same money through its own bank feed, so these rows must never be
 * pushed there (that books it twice), and they must never be deleted (the
 * month would stop tying to the statement).
 *
 * The old check knew only "bank_reconcile*" and "*ledger*", so newer imports
 * (statement_import, capital_one_statement_review, bank_statement,
 * reconciliation_verified_check) slipped through and were pushed.
 */
export function isBankLedgerSource(source: string | null | undefined): boolean {
  return !!source && /bank|statement|ledger|reconcil/i.test(source);
}
