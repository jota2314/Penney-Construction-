-- Track contract amounts per project-subcontractor relationship
CREATE TABLE IF NOT EXISTS project_subcontractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subcontractor_id uuid NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  contract_amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, subcontractor_id)
);

ALTER TABLE project_subcontractors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read project_subcontractors"
  ON project_subcontractors FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert project_subcontractors"
  ON project_subcontractors FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update project_subcontractors"
  ON project_subcontractors FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete project_subcontractors"
  ON project_subcontractors FOR DELETE TO authenticated USING (true);

-- Auto-update updated_at
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON project_subcontractors
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
