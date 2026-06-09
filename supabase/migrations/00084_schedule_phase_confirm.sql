-- Schedule: "confirm to go live" + master-vs-live model.
--
-- Penney's scheduling reality: the master schedule (planned_start_date /
-- planned_end_date, already on this table) never lands as drawn — weather and
-- trade availability push everything. The live schedule (start_date / end_date)
-- is what's actually happening. The missing piece is CONFIRMATION: a phase the
-- office has locked in with the sub/crew. A confirmed phase's dates are firm and
-- get published to the client portal; everything still unconfirmed floats off
-- the most recent confirmed slip (delta cascade) so the plan never overlaps.
--
-- This migration only adds the confirmation columns. Baseline lives in
-- planned_*; live lives in start_date/end_date; cascade is computed in app code.

ALTER TABLE schedule_phases
  ADD COLUMN IF NOT EXISTS is_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_with text;

COMMENT ON COLUMN schedule_phases.is_confirmed IS
  'Office has locked these dates with the sub/crew. Confirmed phases are firm and published to the client portal as real dates; unconfirmed phases show as estimated and slide with the cascade.';
COMMENT ON COLUMN schedule_phases.confirmed_at IS 'When the phase was confirmed.';
COMMENT ON COLUMN schedule_phases.confirmed_with IS 'Free-text name of the sub or crew the dates were confirmed with.';
