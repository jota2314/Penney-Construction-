-- ============================================================
-- Migration 00072: project_customers join table
-- ============================================================
-- A residential project frequently has TWO homeowners (married
-- couples co-signing a contract). The original schema only had a
-- single projects.customer_id, which forced the AI to pick one
-- spouse and quietly drop the other.
--
-- This migration introduces a many-to-many join. We KEEP
-- projects.customer_id as a denormalized "primary contact" cache
-- so existing UI code, queries, and the AI's create_project tool
-- keep working unchanged.

CREATE TABLE IF NOT EXISTS project_customers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  is_primary   boolean NOT NULL DEFAULT false,
  role         text,
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_project_customers_project ON project_customers (project_id);
CREATE INDEX IF NOT EXISTS idx_project_customers_customer ON project_customers (customer_id);

-- Only one primary per project. Partial unique index — co-owners
-- (is_primary=false) can be unlimited.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_customers_one_primary
  ON project_customers (project_id) WHERE is_primary = true;

ALTER TABLE project_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view project_customers"
  ON project_customers FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create project_customers"
  ON project_customers FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Authenticated users can update project_customers"
  ON project_customers FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Users can delete own project_customers"
  ON project_customers FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'owner'
    )
  );

-- Backfill: every project that already has a customer_id gets a
-- corresponding project_customers row marked primary.
INSERT INTO project_customers (project_id, customer_id, is_primary, created_by)
SELECT p.id, p.customer_id, true, p.created_by
FROM projects p
WHERE p.customer_id IS NOT NULL
ON CONFLICT (project_id, customer_id) DO NOTHING;
