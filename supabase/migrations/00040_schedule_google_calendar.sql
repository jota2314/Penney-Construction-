-- Add Google Calendar integration columns to schedule_phases
ALTER TABLE schedule_phases
  ADD COLUMN IF NOT EXISTS google_calendar_event_id text,
  ADD COLUMN IF NOT EXISTS google_meet_link text,
  ADD COLUMN IF NOT EXISTS event_type text DEFAULT 'phase';

-- Make project_id nullable so events can be created without a project
ALTER TABLE schedule_phases ALTER COLUMN project_id DROP NOT NULL;
