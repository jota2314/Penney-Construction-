-- ============================================================
-- Migration 00073: Estimate sections + allowance flag
-- ============================================================
-- Sections let estimators group line items per room ("Master Bath",
-- "Common Bath", "Kitchen") so multi-bathroom houses get a clean
-- breakdown in the proposal PDF. Allowance flag marks placeholder
-- amounts ("subject to actual cost") that render highlighted in
-- yellow on the proposal.

ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS section text,
  ADD COLUMN IF NOT EXISTS is_allowance boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_estimate_line_items_section
  ON estimate_line_items (estimate_id, section);
