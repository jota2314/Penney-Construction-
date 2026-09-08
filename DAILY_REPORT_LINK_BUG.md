# Daily reports disconnected from clock-outs — September 8, 2026

Confirmed against origin/main at 2a92b48 and live Penney records. No production changes made.

## Cause

`getMyPendingDailyReports` only returns completed shifts. A worker who opens the composer while clocked in therefore has no `activeReport`. `postDailyLog` inserts a separate completed row rather than calling `submit_shift_daily_report`. `clockOutWithLog` subsequently closes the shift but does not reconcile that earlier post. The database has only an updated-at trigger, with no reconciliation trigger.

The standalone insert also omits `kind`, inheriting the database's `shift` default despite having zero duration. This is a separate classification regression.

All times below are America/New_York, September 8:

| Worker | Project | Update posted | Clock-out |
|---|---|---|---|
| Dylan Wiselquist | Parziale | 15:15:41 | 15:15:52 |
| Wayne Dobrosielski | Parziale | 15:16:36 | 15:16:52 |
| Jonathan Tanner | White | 16:09:47 | 16:10:36 |
| Jerson Coronado | O'Mealia | 16:33:36 | 16:34:10 |

Their four main shifts have `report_required=true`, `report_submitted_at=null`, and `daily_report_id=null`, despite saved write-ups. Dylan also has a separate 2.5-second shift starting at 15:23:52, after his report; it is not evidence of a second missing write-up and should be reviewed separately.

## Prepared fix

- A transactional, security-invoker trigger reconciles written standalone posts on either post insertion or clock-out. Match the same worker, project and Eastern workday, and wait until all segments on that job are closed. A later visit requires a newer report.
- Preserve original hours, post IDs, text and photos; only link pending shift metadata.
- Restore report-due status if a linked standalone post is deleted.
- Explicitly classify future standalone inserts as `kind='post'`.
- No historical backfill is included. Existing records require a separately scoped repair.

## Verification

`scripts/test-daily-report-link.cjs` executes the actual migration in disposable PGlite PostgreSQL. It reproduces the original failure before installation, then verifies before/after clock-out ordering, preservation of hours and photos, retries, cross-worker/job/day isolation, photo-only/subcontractor exclusions, multiple segments, later visits, Eastern midnight, deletion, authenticated-worker RLS, and compatibility with the existing explicit-report RPC. The existing daily-log rendering test also passes.

Run the database regression with `@electric-sql/pglite@0.5.8` available on NODE_PATH. The local test runtime is in `../work/daily-report-test-runtime/node_modules`.

Migration and app change are local on branch `fix/daily-report-link`; neither has been deployed. Full application build and concurrent multi-session database stress testing have not been run.
