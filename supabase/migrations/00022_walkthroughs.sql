-- ============================================================
-- 00022: Walkthroughs (Pre-Con Site Documentation)
-- Separate table from site_visits for estimation/scoping visits
-- ============================================================

-- 1. Walkthroughs table
CREATE TABLE public.walkthroughs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  estimate_id uuid REFERENCES public.estimates(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  address text,
  city text,
  state text,
  zip text,
  visited_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  purpose text,
  summary text,
  created_by uuid REFERENCES public.profiles(id) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_walkthroughs_estimate_id ON public.walkthroughs(estimate_id);
CREATE INDEX idx_walkthroughs_project_id ON public.walkthroughs(project_id);
CREATE INDEX idx_walkthroughs_status ON public.walkthroughs(status);
CREATE INDEX idx_walkthroughs_visited_at ON public.walkthroughs(visited_at);

-- 2. Walkthrough notes
CREATE TABLE public.walkthrough_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  walkthrough_id uuid NOT NULL REFERENCES public.walkthroughs(id) ON DELETE CASCADE,
  content text NOT NULL,
  source text NOT NULL DEFAULT 'typed' CHECK (source IN ('typed', 'voice')),
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_walkthrough_notes_walkthrough_id ON public.walkthrough_notes(walkthrough_id);

-- 3. Walkthrough files (photos)
CREATE TABLE public.walkthrough_files (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  walkthrough_id uuid NOT NULL REFERENCES public.walkthroughs(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_size integer NOT NULL,
  mime_type text NOT NULL,
  caption text,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_walkthrough_files_walkthrough_id ON public.walkthrough_files(walkthrough_id);

-- 4. RLS policies
ALTER TABLE public.walkthroughs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.walkthrough_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.walkthrough_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view walkthroughs"
  ON public.walkthroughs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert walkthroughs"
  ON public.walkthroughs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update walkthroughs"
  ON public.walkthroughs FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete walkthroughs"
  ON public.walkthroughs FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view walkthrough notes"
  ON public.walkthrough_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert walkthrough notes"
  ON public.walkthrough_notes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update walkthrough notes"
  ON public.walkthrough_notes FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete walkthrough notes"
  ON public.walkthrough_notes FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view walkthrough files"
  ON public.walkthrough_files FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert walkthrough files"
  ON public.walkthrough_files FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can delete walkthrough files"
  ON public.walkthrough_files FOR DELETE TO authenticated USING (true);

-- 5. Migrate existing estimation site visits to walkthroughs
INSERT INTO public.walkthroughs (id, name, estimate_id, project_id, address, city, state, zip, visited_at, status, purpose, summary, created_by, created_at, updated_at)
SELECT id, COALESCE(name, 'Walkthrough'), estimate_id, project_id, address, city, state, zip, visited_at, status, purpose, summary, created_by, created_at, updated_at
FROM public.site_visits
WHERE visit_type = 'pricing' OR project_id IS NULL;

INSERT INTO public.walkthrough_notes (id, walkthrough_id, content, source, sort_order, created_by, created_at, updated_at)
SELECT sn.id, sn.site_visit_id, sn.content, sn.source, sn.sort_order, sn.created_by, sn.created_at, sn.updated_at
FROM public.site_visit_notes sn
INNER JOIN public.walkthroughs w ON w.id = sn.site_visit_id;

INSERT INTO public.walkthrough_files (id, walkthrough_id, storage_path, file_name, file_size, mime_type, caption, uploaded_by, created_at)
SELECT sf.id, sf.site_visit_id, sf.storage_path, sf.file_name, sf.file_size, sf.mime_type, sf.caption, sf.uploaded_by, sf.created_at
FROM public.site_visit_files sf
INNER JOIN public.walkthroughs w ON w.id = sf.site_visit_id;

-- 6. Delete migrated data from site_visits
DELETE FROM public.site_visits
WHERE visit_type = 'pricing' OR project_id IS NULL;

-- 7. Clean up site_visits table
ALTER TABLE public.site_visits DROP CONSTRAINT IF EXISTS site_visits_project_or_name_check;
ALTER TABLE public.site_visits ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.site_visits DROP COLUMN IF EXISTS estimate_id;
ALTER TABLE public.site_visits DROP COLUMN IF EXISTS name;
ALTER TABLE public.site_visits DROP COLUMN IF EXISTS address;
ALTER TABLE public.site_visits DROP COLUMN IF EXISTS city;
ALTER TABLE public.site_visits DROP COLUMN IF EXISTS state;
ALTER TABLE public.site_visits DROP COLUMN IF EXISTS zip;

ALTER TABLE public.site_visits DROP CONSTRAINT IF EXISTS site_visits_visit_type_check;
ALTER TABLE public.site_visits ADD CONSTRAINT site_visits_visit_type_check CHECK (visit_type IN ('progress', 'punch_list'));
