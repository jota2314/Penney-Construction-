-- Client portal: let the client act from their phone. Nothing a client taps
-- erases anything — Remove / Not needed only hide (restorable from the
-- project's Portal tab), and every tap drops a to-do on the team's list.

ALTER TABLE schedule_phases
  ADD COLUMN IF NOT EXISTS client_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_completed_by text;

ALTER TABLE client_selection_items
  ADD COLUMN IF NOT EXISTS client_action text CHECK (client_action IN ('approved', 'removed')),
  ADD COLUMN IF NOT EXISTS client_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_action_by text;

ALTER TABLE client_selections
  ADD COLUMN IF NOT EXISTS client_done_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_dismissed_at timestamptz;

COMMENT ON COLUMN schedule_phases.client_completed_at IS 'Client marked this phase complete on the portal. Display only on the portal; the board status stays the team''s.';
COMMENT ON COLUMN client_selection_items.client_action IS 'Client tapped Approve or Remove on the portal. Removed = hidden from the client (restorable), never erased.';
COMMENT ON COLUMN client_selections.client_dismissed_at IS 'Client tapped Not needed on the portal: hidden from the client and from Needed from you (restorable).';
COMMENT ON COLUMN client_selections.client_done_at IS 'Client tapped Done on the portal (status flipped to selected).';
