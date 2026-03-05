-- Add visit_type column to site_visits
ALTER TABLE site_visits
  ADD COLUMN visit_type text NOT NULL DEFAULT 'progress';

-- Add check constraint for valid types
ALTER TABLE site_visits
  ADD CONSTRAINT site_visits_visit_type_check
  CHECK (visit_type IN ('pricing', 'progress', 'punch_list'));
