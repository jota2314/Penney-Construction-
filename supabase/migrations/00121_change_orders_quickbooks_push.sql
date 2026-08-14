-- Push signed/approved change orders into QuickBooks: the CO is appended as a
-- line on the project's QBO Estimate (or a new estimate is created when the
-- job has none). These columns make the push idempotent and traceable.
-- Applied live 2026-08-14 via MCP apply_migration (change_orders_quickbooks_push).

alter table change_orders
  add column if not exists quickbooks_estimate_id text,
  add column if not exists quickbooks_pushed_at timestamptz;
