-- Add google_refresh_token column to profiles table
-- This allows Google OAuth refresh tokens to survive cookie expiry
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS google_refresh_token text;
