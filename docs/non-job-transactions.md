# Non-job transaction resolution

Office users can resolve an existing transaction in **Sort out spending** as **Owner Draw** or **Credit Card Payment/Transfer**. The explicit confirmation clears job/budget allocation and review flags. It does not create a bill, change an amount or payment, send anything to QuickBooks, or change bank activity. Resolved records are excluded from job costs, operating expenses and payables. Source files and existing QuickBooks references remain on the original record.

The resolved list and transaction detail retain actor, date, reason, note and immutable before/after history. Reopening requires an explanation and the current record version, returns the original record to review, and requires normal job/budget allocation before confirming it as an expense. History remains accessible after reassignment. Split/duplicate groups, locked budget lines and final job audits must use their existing review workflows first.

## Deployment and verification

Apply `supabase/migrations/20261105185637_non_job_transaction_resolution.sql` before deploying these application readers. The migration is additive, with no financial backfill. It preserves the ordinary job-plus-budget confirmation requirement. New history is readable only by office roles; writes come only from the audit trigger. Service-role sync cannot classify or rewrite resolved records.

Relevant checks:

```text
node scripts/non-job-spend.database.test.mjs
node scripts/non-job-spend.actions-sync.test.mjs
node scripts/non-job-spend-ui.test.cjs
node scripts/non-job-pay-approval.test.cjs
node scripts/expense-model.test.mjs
node scripts/open-bills.test.mjs
node scripts/overview-cash.test.mjs
node scripts/overhead-allocation.test.mjs
node scripts/job-review.test.mjs
node scripts/test-financial-daily-log.cjs
node node_modules/next/dist/bin/next build --webpack
```

The database test uses `PGLITE_MODULE` for an available PGlite module or the installed package. All external QuickBooks calls in tests are mocked.

## Interrupted QuickBooks sends

Outbound invoice sends acquire a private durable claim under the same invoice-row lock used by classification. A classified invoice cannot acquire a claim, and an active claim blocks classification. Known failures before a financial remote request release the claim. A timeout, malformed response, failed local link stamp or process crash after a possible financial request retains it. Verified completion releases it. Claims have no automatic expiry.

The private `finance_internal.invoice_quickbooks_push_claims` table records `invoice_id`, `claim_token` and `claimed_at`. Operational recovery requires verifying the external transaction and the original app link first. After reconciliation, the service-only `release_invoice_quickbooks_push(p_claim_token)` RPC releases only that token. Releasing a claim is never permission to send or pay again. Do not add an automatic timeout/retry that assumes a missing response means the external operation failed.
