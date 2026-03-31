-- ============================================================
-- Migration 00041: Todo categories, assignee, and AI execution
-- ============================================================

-- 1. Create the todo_category enum
DO $$ BEGIN
  CREATE TYPE todo_category AS ENUM (
    'quotes',
    'estimates',
    'scheduling',
    'follow_up_quotes',
    'follow_up_clients',
    'permits_inspections',
    'materials',
    'change_orders',
    'payments',
    'contracts_docs',
    'general'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add category column to todos
ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS category todo_category NOT NULL DEFAULT 'general';

-- 3. Add assignee column (team member name)
ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS assignee text;

-- 4. Add snooze_until column for smart snooze
ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS snooze_until timestamptz;

-- 5. Add ai_summary for storing AI-generated context
ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS ai_summary text;

-- 6. Add source tracking (manual, ai_email, ai_execute)
ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

-- 7. Index on category for filtering
CREATE INDEX IF NOT EXISTS idx_todos_category ON todos (category);

-- 8. Index on assignee for team filtering
CREATE INDEX IF NOT EXISTS idx_todos_assignee ON todos (assignee);

-- 9. Index on snooze_until for wake-up queries
CREATE INDEX IF NOT EXISTS idx_todos_snooze ON todos (snooze_until) WHERE snooze_until IS NOT NULL;
