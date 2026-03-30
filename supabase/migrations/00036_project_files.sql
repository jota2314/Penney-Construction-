-- Project files table for direct uploads with categories
CREATE TABLE IF NOT EXISTS project_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size integer DEFAULT 0,
  category text NOT NULL DEFAULT 'other' CHECK (category IN (
    'construction_drawings', 'specs', 'pricing', 'contracts', 'permits', 'photos', 'invoices', 'estimates', 'other'
  )),
  description text,
  uploaded_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_project_files_project ON project_files(project_id);
CREATE INDEX idx_project_files_category ON project_files(category);

ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_files_select" ON project_files FOR SELECT TO authenticated USING (true);
CREATE POLICY "project_files_insert" ON project_files FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "project_files_update" ON project_files FOR UPDATE TO authenticated USING (true);
CREATE POLICY "project_files_delete" ON project_files FOR DELETE TO authenticated USING (true);

-- Update project-files storage bucket to accept all file types
UPDATE storage.buckets SET allowed_mime_types = NULL WHERE id = 'project-files';
UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'project-files';
