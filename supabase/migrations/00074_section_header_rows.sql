-- ============================================================
-- Migration 00074: Section header rows
-- ============================================================
-- Section headers are stored as regular estimate_line_items rows
-- with is_section_header=true. The row's `description` holds the
-- section name ("Master Bath", "Kitchen"). Regular line items below
-- a header (by sort_order) belong to that section. Subtotals are
-- computed at render time from the rows between two headers.
--
-- This is simpler than tracking section membership per row — the
-- section is defined by position, so reordering "just works."

ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS is_section_header boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_estimate_line_items_section_header
  ON estimate_line_items (estimate_id, sort_order)
  WHERE is_section_header = true;
