-- ============================================================
-- Migration 00075: Gmail per-user backoff timestamp
-- ============================================================
-- When Gmail returns 429 (User-rate limit exceeded / abuse
-- heuristic), set this timestamp so the cron and manual fetch
-- routes skip the user entirely until the backoff clears. Without
-- this, a single throttle on one account snowballs into hundreds
-- of cron retries that extend Gmail's penalty window — exactly
-- what locked Jorge's account out for hours.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS gmail_backoff_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_gmail_backoff
  ON profiles (gmail_backoff_until)
  WHERE gmail_backoff_until IS NOT NULL;
