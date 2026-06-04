-- ══════════════════════════════════════════════════
-- Migration 00082: Add John Denis (Lead Carpenter, field)
-- ══════════════════════════════════════════════════
-- Adds John Denis as a field employee + allowlist entry so his Google
-- login auto-claims the employee row and gets stamped 'field' by the
-- handle_new_user() trigger (see 00077).
--
-- Fully idempotent — safe to re-run.

DO $$
DECLARE
  creator_id uuid;
BEGIN
  -- created_by is NOT NULL and references auth.users(id); attribute to any owner.
  SELECT id INTO creator_id
  FROM public.profiles
  WHERE role = 'owner'
  ORDER BY created_at
  LIMIT 1;

  -- Employee record (unclaimed until John signs in; trigger links profile_id).
  INSERT INTO public.employees
    (first_name, last_name, email, title, status, phone, hourly_rate, created_by)
  SELECT 'John', 'Denis', 'johndenis@penneyconstructioninc.com',
         'Lead Carpenter', 'active'::employee_status, '9784794838', 50.00, creator_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.employees
    WHERE lower(email) = 'johndenis@penneyconstructioninc.com'
  );

  -- Allowlist entry so the Google login is permitted and auto-claims as 'field'.
  INSERT INTO public.allowed_emails (email, role, invited_by)
  SELECT 'johndenis@penneyconstructioninc.com', 'field', creator_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.allowed_emails
    WHERE lower(email) = 'johndenis@penneyconstructioninc.com'
  );
END $$;
