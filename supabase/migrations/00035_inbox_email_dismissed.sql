-- Add dismissed flag to inbox_emails for "not interested" emails
ALTER TABLE inbox_emails ADD COLUMN IF NOT EXISTS is_dismissed boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_inbox_emails_dismissed ON inbox_emails(is_dismissed);
