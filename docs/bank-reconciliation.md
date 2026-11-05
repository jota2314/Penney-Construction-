# Bank activity and reconciliation

Expenses retains bill-date purchases and credits. A separate Eastern checking
panel uses bank posting dates for the same selected period. Its account totals
do not change with expense category or job filters. The selected Cash flow month
uses the same panel. An explicitly requested empty month stays empty; invalid or
unloaded years never silently substitute another month's money.

Cash comes only from imported Eastern transactions. Payroll funding, card
repayments, checks and other withdrawals partition the debit total in integer
cents. Card-source purchases, bill costs and payroll allocations are never added
to this total. Incoming credits remain separate from withdrawals; net movement
does not include the opening balance and is not profit or available cash.

The model validates dates, directions, amounts, supported sources, stable IDs and
external references. Identical IDs count once. Conflicting records, fractional
cents or possibly repeated external references make the total unavailable, not
zero. A complete query failure never becomes a partial bank total. All periods,
including prior years and cross-year weeks, use explicit inclusive boundaries.

Every imported row and source filename is inspectable. Existing bill and receipt
links show their amounts and conflicts; they do not change bank cash. Partial,
overallocated or malformed links remain visible. No new matches, invoices,
payments, allocation corrections or status changes are created by this view.

## What is required before a month can be called reconciled

1. Obtain each account's complete original statement and retain its source.
2. Verify opening balance plus credits minus debits equals closing balance,
   including statement debit/credit totals and transaction inventory.
3. Verify bill, receipt, payroll and transfer evidence; resolve duplicate,
   missing, split and timing issues without posting the same cost twice.
4. Preserve the evidence and explicit approval through the existing review and
   accounting-period controls. A locked period alone is not proof of reconciliation.

The current schema has no verified statement-control record for this screen.
Therefore it always identifies imported activity and keeps statement difference
unverified, even when stored links cover every cent. Source filenames, maximum
transaction dates and match_status labels cannot establish complete coverage.
No reconciliation approval button is introduced that could bypass those checks.

## Verification

Run bank-period, cash-activity, expense-model and overview-cash tests with Node's
test runner. Server-rendered component tests cover exact cents, native bill links,
unavailable periods, malformed data and overlinked records without controlling a
browser. Run targeted lint, TypeScript and the production build. Read-only live
data and deployment evidence stay in the company review workspace, outside Git.
