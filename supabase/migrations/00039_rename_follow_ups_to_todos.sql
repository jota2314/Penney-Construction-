-- Rename follow_ups table to todos
ALTER TABLE IF EXISTS follow_ups RENAME TO todos;

-- Rename indexes
ALTER INDEX IF EXISTS idx_follow_ups_project RENAME TO idx_todos_project;
ALTER INDEX IF EXISTS idx_follow_ups_status RENAME TO idx_todos_status;

-- Rename RLS policy
ALTER POLICY IF EXISTS "Authenticated users can manage follow_ups" ON todos RENAME TO "Authenticated users can manage todos";
