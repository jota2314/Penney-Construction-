# Unified Finance workspace

`/finances` contains collections, project health, final project P&Ls, open bills,
cash activity, the daily log, expenses, income, overhead and Weekly Close. The
former routes redirect to the matching section and retain their query parameters.
The original financial screens were extracted into server components, preserving
their native invoice, bill, receipt and payment workflows. Command Center is unchanged.

## Project health and collections

The portfolio loads complete inventories, uses the shared historical labor/break
model and current-estimate selector, excludes explicit duplicate bills, and keeps
unknown budgets and remaining costs unknown. Source/import and allocation problems
are visible. Collection balances exclude drafts and isolate discrepancies between
linked receipts and invoice paid amounts. Dollar arithmetic uses integer cents.

Forecasts are explicit remaining-cost estimates with an explanation and a saved
review. They include at least the known unbilled commitments. Relevant financial
record changes make them stale instead of silently displaying the old forecast.

## Final audit workflow

1. Open **Review & finalize** on the job and check current audit readiness.
2. Complete the existing evidence review. Each incurred scope needs current saved
   verification, including versioned originals. Resolve gaps, allocation questions,
   stale findings, pending change orders and unbilled commitments.
3. Upload the final audit report using project Files, then refresh readiness.
4. An owner or preconstruction manager chooses the actual closing date and report,
   states any additional payroll burden and allocated overhead, explains their
   basis, reviews the resulting final profit and explicitly approves it.
5. The application rechecks source/evidence freshness and the current audit head,
   then appends an immutable final record. It never changes invoices, payments,
   bills or project status. No existing partial review is automatically finalized.

The final record preserves scope costs/hours, final figures, closing date, reviewer,
approval note, source fingerprints, reviewed findings and the report file version.
Its printable HTML P&L is distinct from the native client invoice PDF. Opening the
source report checks its saved version before signing a download URL.

Reopening appends a reason and removes that job from current finalized totals.
Earlier final reports remain accessible in revision history. The next approved
final becomes the current closing-period record. Monthly and annual summaries use
closing dates and weighted profit margin, not approval dates or averaged margins.
These are project results after the stated allocations, not the company's cash
income statement. Open collections are independent of recognized final profit.

## Security and rollout

Migration: `20261009235543_unified_finance_audit_history.sql`.
Applied and read-verified on the connected Penney database during implementation;
the audit table was empty after installation. RLS allows office financial readers.
Authenticated browsers have no insert/update/delete or append-function permission.
The service-only append RPC also validates the real approving role, serializes
changes per project, checks the previous head, and rejects stale source/evidence.
The table denies all updates/deletes, including service-role attempts.

## Verification

- `node --test scripts/finance-workspace.test.mjs scripts/job-review.test.mjs scripts/open-bills.test.mjs`
- `PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node --test scripts/finance-audit-db.test.mjs`
  uses a disposable in-memory PostgreSQL database, never the live ledger.
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/next/dist/bin/next build --webpack`
- Browser fixture: temporarily copy `scripts/fixtures/finance-preview.tsx` to
  `src/app/finance-preview/page.tsx`, run the development server on port 3127, and
  run `node scripts/finance-browser-check.cjs`. Remove that temporary route and
  its generated `.next/dev` types before building. The fixture uses only synthetic
  data and mocked audit requests. It reads no cookies, auth files or live records.

Authenticated browser verification was not performed: automatic approval review
rejected reuse of a saved local authentication session. Synthetic desktop/mobile
checks, existing audit reconciliation tests, database permissions/concurrency tests
and production compilation provide the completed verification coverage.
