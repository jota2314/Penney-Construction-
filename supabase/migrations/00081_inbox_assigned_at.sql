-- The auto-triage cron is the ASSIGNER: it classifies each inbound email and
-- routes it to the right agent (Bookkeeper Bill for bills, Dispatch Dan for the
-- rest). It must not mark mail "done" — that is auto_triaged_at, which the MCP
-- crew's list_inbox uses as its work queue (auto_triaged_at IS NULL).
--
-- assigned_at is the cron's OWN marker: "I have classified + routed this." The
-- cron filters its candidates on assigned_at IS NULL so it never re-scans, while
-- auto_triaged_at stays NULL until an agent (or the cron's own auto-file) truly
-- finishes the email. This decouples "the assigner looked at it" from "the work
-- is done" — previously both used auto_triaged_at, so the cron emptied the crew's
-- queue 1-2 minutes after each email landed.

ALTER TABLE inbox_emails
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

-- Backfill: anything already triaged is already "assigned" — don't let the cron
-- re-scan the whole history when it switches to the assigned_at filter.
UPDATE inbox_emails
  SET assigned_at = auto_triaged_at
  WHERE auto_triaged_at IS NOT NULL
    AND assigned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_emails_assigned_at
  ON inbox_emails (assigned_at)
  WHERE assigned_at IS NULL;
