CREATE TABLE IF NOT EXISTS takeoff_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id uuid REFERENCES project_files(id) ON DELETE CASCADE,
  storage_path text,
  page_number integer DEFAULT 1,
  scale_pixels_per_foot numeric,
  scale_label text,
  measurement_type text NOT NULL CHECK (measurement_type IN ('linear', 'area', 'count')),
  label text NOT NULL,
  trade text,
  color text DEFAULT '#F59E0B',
  points jsonb NOT NULL DEFAULT '[]',
  value numeric,
  unit text DEFAULT 'ft',
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_takeoff_project ON takeoff_measurements(project_id);
CREATE INDEX idx_takeoff_file ON takeoff_measurements(file_id);

ALTER TABLE takeoff_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "takeoff_select" ON takeoff_measurements FOR SELECT TO authenticated USING (true);
CREATE POLICY "takeoff_insert" ON takeoff_measurements FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "takeoff_update" ON takeoff_measurements FOR UPDATE TO authenticated USING (true);
CREATE POLICY "takeoff_delete" ON takeoff_measurements FOR DELETE TO authenticated USING (true);
