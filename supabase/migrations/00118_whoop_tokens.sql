-- WHOOP OAuth: per-user refresh token, same pattern as google_refresh_token.
-- WHOOP rotates refresh tokens on every use, so this column is rewritten
-- by /api/whoop/data each time the access token is refreshed.
alter table public.profiles
  add column if not exists whoop_refresh_token text;
