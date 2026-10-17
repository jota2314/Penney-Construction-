-- Selections log, phase 2: job mail feeds the log as SUGGESTED updates.
--
-- The fetch-emails cron reads inbound mail on jobs that have open
-- selection_items (client picks, showroom/vendor quotes, order confirmations,
-- delivery notices) and files each proposed change in agent_suggestions with
-- kind 'selection_update'. Nothing is applied until a person approves it;
-- approving runs the change through the selections service, so the ladder
-- rules and the history row are the same as any other update.
--
-- This stamp marks an email as read for that, so an email with nothing in it
-- isn't re-read (and re-billed) every tick.

ALTER TABLE inbox_emails ADD COLUMN IF NOT EXISTS selections_checked_at timestamptz;

-- The Selections log panel lists a job's pending suggestions.
CREATE INDEX IF NOT EXISTS idx_agent_suggestions_selection_pending
  ON agent_suggestions (project_id, created_at DESC)
  WHERE kind = 'selection_update' AND status = 'pending';
