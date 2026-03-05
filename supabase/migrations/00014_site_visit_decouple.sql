-- ============================================================
-- 00014: Decouple Site Visits from Projects
-- Site visits can now exist without a project (estimation visits)
-- ============================================================

-- 1. Make project_id nullable
ALTER TABLE site_visits ALTER COLUMN project_id DROP NOT NULL;

-- 2. Add estimate_id FK (link estimation visits to estimates)
ALTER TABLE site_visits
  ADD COLUMN estimate_id uuid REFERENCES public.estimates(id) ON DELETE SET NULL;

-- 3. Add name for standalone visits (e.g. "Smith Kitchen")
ALTER TABLE site_visits ADD COLUMN name text;

-- 4. Add address fields for standalone visits (no project to pull from)
ALTER TABLE site_visits ADD COLUMN address text;
ALTER TABLE site_visits ADD COLUMN city text;
ALTER TABLE site_visits ADD COLUMN state text;
ALTER TABLE site_visits ADD COLUMN zip text;

-- 5. Constraint: must have either project_id or name
ALTER TABLE site_visits
  ADD CONSTRAINT site_visits_project_or_name_check
  CHECK (project_id IS NOT NULL OR name IS NOT NULL);

-- 6. Index on estimate_id for lookups
CREATE INDEX idx_site_visits_estimate_id ON public.site_visits(estimate_id);
