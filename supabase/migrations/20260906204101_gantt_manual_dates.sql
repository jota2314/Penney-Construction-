-- Preserve explicit Gantt moves while retaining the original planned baseline.
ALTER TABLE public.schedule_phases ADD COLUMN IF NOT EXISTS is_manually_scheduled boolean NOT NULL DEFAULT false;
