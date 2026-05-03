-- ============================================================
-- Migration 00070: Punch list category + completion artifacts
-- ============================================================
-- A "punch list" is a per-project list of small fixes/finish items
-- that field workers complete with a required photo. Reuses the
-- existing todos table — the category just identifies these rows
-- so they can be grouped and given different completion rules
-- (photo required, visible to whole team).

-- 1. Add the new category. ALTER TYPE ... ADD VALUE is safe outside
--    a transaction block; do not reference the new value elsewhere
--    in this migration.
ALTER TYPE todo_category ADD VALUE IF NOT EXISTS 'punch_list';

-- 2. Dedicated columns for completion artifacts. Previously the
--    photo + note were stuffed into ai_summary as a free-text blob;
--    splitting them out lets the UI show a thumbnail without parsing.
ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS completion_photo_path text,
  ADD COLUMN IF NOT EXISTS completion_note text;
