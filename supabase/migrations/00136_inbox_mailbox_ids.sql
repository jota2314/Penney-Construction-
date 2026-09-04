-- Nicole's inbox was missing a third of her mail.
--
-- Migration 00082 dedups inbox_emails on the RFC822 Message-ID so one email
-- that lands in several team mailboxes is stored ONCE. But the row keeps a
-- single owner (created_by = whichever profile's Gmail synced first), and
-- every inbox view filters on created_by. The cron rotates the sync order,
-- so a message sent to Nicole AND Jorge was stored under Jorge about as
-- often as under Nicole — and then never showed in Nicole's inbox at all.
-- Measured on 2026-09-04: 814 emails addressed to/from nsmith@ were sitting
-- under other people's created_by.
--
-- Fix: track every mailbox the message was seen in. created_by stays the
-- first syncer (it drives dedup + the AI crew); mailbox_ids is the list of
-- profiles whose Gmail contains the message, and the inbox views filter on
-- membership instead of ownership.

ALTER TABLE inbox_emails
  ADD COLUMN IF NOT EXISTS mailbox_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_inbox_emails_mailbox_ids
  ON inbox_emails USING gin (mailbox_ids);

-- Atomic "this message is also in my mailbox" stamp. The sync calls it when
-- the rfc822 dedup says another account already stored the message.
CREATE OR REPLACE FUNCTION inbox_email_add_mailbox(
  p_rfc822_message_id text,
  p_profile_id uuid
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE inbox_emails
  SET mailbox_ids = array_append(mailbox_ids, p_profile_id)
  WHERE rfc822_message_id = p_rfc822_message_id
    AND NOT (p_profile_id = ANY (mailbox_ids))
  RETURNING id;
$$;

GRANT EXECUTE ON FUNCTION inbox_email_add_mailbox(text, uuid) TO authenticated, service_role;

-- Backfill. We can't re-read Gmail for history, but the From/To headers
-- tell us who else the message belonged to: the owner, plus every profile
-- whose address is the sender or the (first) recipient. CC'd teammates on
-- old rows stay lost; the sync stamps them correctly from here on.
UPDATE inbox_emails e
SET mailbox_ids = sub.ids
FROM (
  SELECT e2.id, array_agg(DISTINCT p.id) AS ids
  FROM inbox_emails e2
  JOIN profiles p
    ON p.id = e2.created_by
    OR (
      p.email IS NOT NULL
      AND (
        e2.to_email ILIKE '%' || p.email || '%'
        OR e2.from_email ILIKE '%' || p.email || '%'
      )
    )
  GROUP BY e2.id
) sub
WHERE sub.id = e.id
  AND e.mailbox_ids = '{}';
