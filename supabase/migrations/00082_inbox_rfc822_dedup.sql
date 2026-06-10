-- inbox_emails stored the same logical email once per recipient mailbox.
-- The cron loops the Gmail sync over every profile with a refresh token
-- (Jorge, Ryan, Brian today). Gmail assigns a DIFFERENT message id AND a
-- different thread id to the same RFC822 message in each account, so the
-- old dedup key (gmail_message_id) could never catch the cross-account
-- copies. Result: a client email landing in two team inboxes became two
-- rows, and the MCP crew (Dispatch Dan / Bookkeeper Bill) acted on both
-- — double-drafted replies, and bills could dodge record_invoice's
-- gmail_message_id dedup because the duplicate carried a different id.
--
-- The RFC822 "Message-ID" header is the stable, globally-unique identifier:
-- it is identical across every mailbox the message touches. We capture it
-- on sync and dedup on it instead.

ALTER TABLE inbox_emails
  ADD COLUMN IF NOT EXISTS rfc822_message_id text;

-- Going-forward guard. Old rows predate header capture and stay NULL, so
-- the index is partial (NULLs are exempt and never collide). Once the sync
-- starts writing this column, a second account's copy of the same message
-- is rejected at the DB level even if the app-side check races.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_emails_rfc822_message_id
  ON inbox_emails (rfc822_message_id)
  WHERE rfc822_message_id IS NOT NULL;
