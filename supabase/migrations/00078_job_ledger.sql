-- ============================================================
-- Migration 00078: Job ledger (automatic Drive-synced job costing)
-- ============================================================
-- Penney tracks each job's real money (deposits in + vendor/labor
-- payments out) by hand in a per-job Google Sheet "Ledger" living in
-- the Shared Drive, with receipt photos in a sibling "receipts"
-- folder. The app had quotes (what subs BID) but none of the ACTUALS.
--
-- This migration adds the storage the app needs to pull those ledgers
-- in automatically:
--   * projects.ledger_drive_file_id / ledger_drive_url  — the link to
--     each job's Google Sheet ledger (auto-discovered or set once).
--   * job_ledger_entries — one row per ledger line (deposit/expense),
--     synced from the sheet and deduped by external_ref.
--   * job_ledger_summary — money-in / money-out / cash-balance per job.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ledger_drive_file_id text,
  ADD COLUMN IF NOT EXISTS ledger_drive_url     text;

CREATE TABLE IF NOT EXISTS job_ledger_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entry_date   date,
  description  text,
  -- Signed amount: positive = money IN (deposit), negative = money OUT.
  amount       numeric(14,2) NOT NULL DEFAULT 0,
  direction    text NOT NULL CHECK (direction IN ('deposit','expense')),
  category     text,
  -- 'drive_sync' for rows pulled from the Google Sheet, 'manual' for
  -- entries typed into the app.
  source       text NOT NULL DEFAULT 'drive_sync',
  -- Stable per-row key used to dedupe on re-sync (hash of date|desc|amount).
  external_ref text,
  synced_at    timestamptz,
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_ledger_project ON job_ledger_entries (project_id);

-- Re-syncing the same sheet must not duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_ledger_dedupe
  ON job_ledger_entries (project_id, external_ref)
  WHERE external_ref IS NOT NULL;

-- Per-project money in / money out / cash on hand.
CREATE OR REPLACE VIEW job_ledger_summary AS
SELECT
  project_id,
  COALESCE(SUM(amount) FILTER (WHERE direction = 'deposit'), 0)  AS total_deposits,
  COALESCE(-SUM(amount) FILTER (WHERE direction = 'expense'), 0) AS total_expenses,
  COALESCE(SUM(amount), 0)                                       AS cash_balance,
  COUNT(*)                                                       AS entry_count,
  MAX(entry_date)                                               AS last_entry_date,
  MAX(synced_at)                                                AS last_synced_at
FROM job_ledger_entries
GROUP BY project_id;

ALTER TABLE job_ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view job_ledger_entries"
  ON job_ledger_entries FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create job_ledger_entries"
  ON job_ledger_entries FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update job_ledger_entries"
  ON job_ledger_entries FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete job_ledger_entries"
  ON job_ledger_entries FOR DELETE TO authenticated USING (true);
