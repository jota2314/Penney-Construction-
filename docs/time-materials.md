# Client portal time and materials

T&M change orders authorize a scope and billing terms. Their fixed `price_impact` is zero; it is not the final price. Staff record measured charges in a separate ledger, review them, and publish them to the client's existing portal under Payments. Native CO PDFs and signature pages describe the final amount as to be determined.

## Release order

1. Apply `supabase/migrations/20261023160727_change_order_time_materials.sql` through the existing Supabase migration process before deploying the application. It adds billing fields, the ledger, RLS, and authorization/history guards. Existing COs default to fixed price; no existing project is converted or repriced.
2. Deploy the application and verify the CO billing selector, staff log, native PDF, signature page and authenticated staff portal preview against a test project.
3. Convert only an unsent draft that is actually intended to be T&M. Enter the agreed client billing rates and material/markup terms. Do not infer rates from employee wages, vendor cost, or demonstration fixtures. Issued/approved scope and terms remain locked, even after rejection or voiding.

The Haight slab CO was previously saved as a zero-value draft with T&M wording. This release does not change that record automatically. Use its native Edit form to select Time & materials after deployment, and retain it as a draft until the actual billing terms are confirmed. Sending it remains a separate authorized action.

## Staff workflow

Open Project → Finances → Change orders. Create or edit a draft and select Time & materials. Open its T&M log to enter the work date, client description, quantity, unit and client billing rate. A blank rate is pending pricing and cannot be published; an explicit zero is a zero charge.

Entries may reference completed, reviewed labor allocated to this CO or an existing reviewed vendor bill allocated to it. Labor suggestions use the existing full-day break allocation. These are reviewed snapshots: editing another shift later does not automatically update the charge. Changes to the linked source invalidate publication until the draft is reviewed and saved again. Vendor bills still originate in Command Center; this log does not create or edit them.

Save entries as drafts. Once the CO has billing terms and is submitted or approved, review the exact description, quantity, rate and total, then publish. Drafts stay private; the client sees published entries only for COs already sent or approved. A published charge is immutable. To correct it, void it with a client-visible explanation and add a replacement. Voided published entries remain visible, excluded from totals. A linked source can have only one active charge.

Only office roles and the assigned project manager can manage charges. The client projection excludes wages, internal costs, source IDs, source snapshots and staff identifiers. The portal shows hours, quantities, unit billing rates, category subtotals and running charges. Running charges are not invoices. Bill through the existing native client invoice workflow and reconcile charges already billed to avoid duplicate billing.

Project-wide payments are not allocated to fixed contract versus T&M charges. Projects with visible T&M COs therefore display contract value and project payments separately, without a misleading remaining contract balance or percentage paid. Fixed-only projects retain their existing display.

## Verification

```powershell
npm ci --no-audit --no-fund
node --test scripts/change-order-tm.test.mjs scripts/portal-time-materials.test.cjs scripts/labor-ledger.test.mjs scripts/labor-finance-integration.test.mjs scripts/schedule-progress.test.cjs
npm run build
```

SQL tests use isolated in-memory PostgreSQL and require no project credentials. Install the test-only runtime outside the checkout, then pass its module path:

```powershell
npm install --prefix ../tmp/penney-tm-test-runtime --no-package-lock --no-save @electric-sql/pglite@0.3.14
$env:PGLITE_MODULE = (Resolve-Path ../tmp/penney-tm-test-runtime/node_modules/@electric-sql/pglite/dist/index.js).Path
node --test scripts/time-materials-db.test.mjs
```

The tests cover access control, default-privilege revocation, source allocation, duplicates, rounding, stale edits, publication and correction history, durable terms locking, signature races, native PDFs, portal privacy/pagination and fixed-price regressions. PDF and portal visual checks use synthetic project data and rates.

If the app must be rolled back, retain the new schema and ledger records. Do not drop the ledger or remove its history protections after real entries exist. Older app versions do not render T&M billing semantics correctly, so do not send or approve T&M documents through an older version.
