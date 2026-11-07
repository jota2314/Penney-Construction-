# Finance overview and expense definitions

The overview separates month-to-date activity from open balances across all
dates. Receipts are the signed amounts recorded in `payments_received`, including
noncustomer receipts and reversals; they are not labeled customer revenue or
bank-cleared cash. Each source can fail independently without becoming zero.

Expenses use bill dates. All card purchases, unpaid bills and partial bills are
included. Imported bank card repayments are shown only in separate bank activity panels, avoiding a
second cost for the same purchases. Internal wage placeholders and explicit
duplicate records are excluded. Recorded ADP bills and flagged capital purchases
remain visible; this purchase view is not a complete operating P&L.

The expense model sums allocation amounts in integer cents before grouping.
Charges minus credits equals net recorded expenses. Recorded paid amounts and
remaining positive bill balances are separate; a vendor credit does not settle
an unrelated bill. Unknown amounts and payment conflicts remain visible. When
payments are incomplete, the payment cards show explicitly labeled known
subtotals from coherent allocations, with the number excluded for review. No
coherent allocations displays "Needs review". Unassigned jobs are distinct from overhead.
Category and allocation filters apply to totals, charts and transaction rows.
Split rows preserve every project and category, and can be expanded to open each
native source allocation. Undated records are listed separately for review.

Collections, Overview, Cash and project collection totals share the existing
actionable-invoice rule. Reconciliation issues and possible unapplied receipt
matches are excluded from follow-up totals and kept in review. This display rule
does not mark invoices paid or apply receipts. Numeric cost overruns remain
prominent even when the same job also needs evidence verification.

No schema, financial records, approval flows, native invoices, bill-entry forms,
Command Center behavior, or email workflows are changed.

## Validation

Run `node --test scripts/expense-model.test.mjs scripts/finance-overview.test.mjs
scripts/finance-workspace.test.mjs scripts/cash-statement.test.mjs
scripts/open-bills.test.mjs scripts/receipt-invoice-groups.test.cjs`, then targeted
ESLint, TypeScript and the production build. Server-rendered fixture tests cover
source failures and native links without operating a browser or live session.

Read-only live-data diagnostics are retained outside the repository in the
Penney workspace at `financial-reviews/company/2026-11-05-finance-ui/`. They explain
the UI defects and are not a completed company financial audit. They do not
replace the saved company or job audit baselines.
