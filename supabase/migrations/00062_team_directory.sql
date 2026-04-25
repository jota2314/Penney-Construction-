-- ══════════════════════════════════════════════════
-- Migration 00062: Team directory + per-user dashboards
-- ══════════════════════════════════════════════════
-- Adds:
--   1. team_invites table — pre-created office-staff profiles that get
--      auto-claimed when the invited email signs in with Google.
--   2. Defensive creation of allowed_emails and employees.profile_id
--      (they exist in the prod Supabase project but were never in a
--      migration file — make this idempotent so a fresh DB is valid).
--   3. handle_new_user() trigger updated to pull from team_invites and
--      auto-link any unclaimed employees row by email.
--   4. Seeds: 3 office invites (Nicole, Shannon, Howie as 'owner'/'field'),
--      upgrade Jorge to 'owner', delete the 7 dummy employees from 00011,
--      insert the 6 real field workers + 2 hybrid (Jorge, Howie) employee
--      rows, add allowed_emails entries so field logins auto-claim.

-- Fully idempotent — safe to re-run.


-- ── Phase A: allowed_emails table (defensive) ──

CREATE TABLE IF NOT EXISTS public.allowed_emails (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'field',
  invited_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view allowed_emails" ON public.allowed_emails;
CREATE POLICY "Authenticated users can view allowed_emails"
  ON public.allowed_emails FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Owner can manage allowed_emails" ON public.allowed_emails;
CREATE POLICY "Owner can manage allowed_emails"
  ON public.allowed_emails FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner')
  );


-- ── Phase B: employees.profile_id column (defensive) ──

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_profile_id ON public.employees(profile_id);
CREATE INDEX IF NOT EXISTS idx_employees_email ON public.employees(email);


-- ── Phase C: team_invites table ──

CREATE TABLE IF NOT EXISTS public.team_invites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'project_manager'
    CHECK (role IN ('owner', 'precon_manager', 'project_manager', 'office_admin', 'field')),
  phone text,
  invited_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view team_invites" ON public.team_invites;
CREATE POLICY "Authenticated users can view team_invites"
  ON public.team_invites FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Owner can manage team_invites" ON public.team_invites;
CREATE POLICY "Owner can manage team_invites"
  ON public.team_invites FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner')
  );


-- ── Phase D: handle_new_user trigger — pull from team_invites ──

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  invite_row public.team_invites%ROWTYPE;
BEGIN
  SELECT * INTO invite_row
  FROM public.team_invites
  WHERE lower(email) = lower(NEW.email)
  LIMIT 1;

  IF invite_row.id IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, full_name, avatar_url, role, phone)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(invite_row.full_name, NEW.raw_user_meta_data ->> 'full_name'),
      NEW.raw_user_meta_data ->> 'avatar_url',
      invite_row.role,
      invite_row.phone
    );
    DELETE FROM public.team_invites WHERE id = invite_row.id;
  ELSE
    INSERT INTO public.profiles (id, email, full_name, avatar_url)
    VALUES (
      NEW.id,
      NEW.email,
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'avatar_url'
    );
  END IF;

  UPDATE public.employees
  SET profile_id = NEW.id
  WHERE lower(email) = lower(NEW.email) AND profile_id IS NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── Phase E: upgrade Jorge's existing profile to owner ──

UPDATE public.profiles
SET role = 'owner'
WHERE lower(email) = 'jbetancur@penneyconstructioninc.com';


-- ── Phase F: seed team_invites for pending team members ──
-- Nicole and Shannon are owners per Jorge's request. Howie stays field.

INSERT INTO public.team_invites (email, full_name, role)
VALUES
  ('nsmith@penneyconstructioninc.com', 'Nicole Smith', 'owner'),
  ('spenney@penneyconstructioninc.com', 'Shannon Penney', 'owner'),
  ('hclickstein@penneyconstructioninc.com', 'Howie Clickstein', 'field')
ON CONFLICT (email) DO NOTHING;


-- ── Phase G: delete the 7 dummy field employees from migration 00011 ──

DELETE FROM public.employees
WHERE (first_name, last_name) IN (
  ('James',  'Penney'),
  ('Carlos', 'Rivera'),
  ('Tyler',  'Brooks'),
  ('Marcus', 'Johnson'),
  ('Kevin',  'Tran'),
  ('Derek',  'Simmons'),
  ('Ryan',   'Mitchell')
);


-- ── Phase H: seed real employees ──
-- Hybrid: Jorge and Howie. Jorge's profile already exists (claimed), so
-- we set profile_id directly. Howie's profile_id stays null until he
-- signs in — the trigger will link it.

DO $$
DECLARE
  jorge_profile_id uuid;
  creator_id uuid;
BEGIN
  SELECT id INTO jorge_profile_id
  FROM public.profiles
  WHERE lower(email) = 'jbetancur@penneyconstructioninc.com'
  LIMIT 1;

  -- created_by is NOT NULL and references auth.users(id). Fall back to
  -- any owner's auth id if Jorge isn't found.
  SELECT COALESCE(jorge_profile_id, (SELECT id FROM public.profiles WHERE role = 'owner' LIMIT 1))
    INTO creator_id;

  -- Jorge (hybrid): profile already exists, insert linked employee row.
  IF jorge_profile_id IS NOT NULL THEN
    INSERT INTO public.employees
      (first_name, last_name, email, title, hourly_rate, status, profile_id, created_by)
    SELECT 'Jorge', 'Betancur', 'jbetancur@penneyconstructioninc.com',
           'Estimator', 40.00, 'active'::employee_status, jorge_profile_id, creator_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.employees
      WHERE lower(email) = 'jbetancur@penneyconstructioninc.com'
    );
  END IF;

  -- Howie (hybrid, unclaimed): employee row now, profile_id links on signup.
  INSERT INTO public.employees
    (first_name, last_name, email, title, hourly_rate, status, created_by)
  SELECT 'Howie', 'Clickstein', 'hclickstein@penneyconstructioninc.com',
         'Field Lead', 62.00, 'active'::employee_status, creator_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.employees
    WHERE lower(email) = 'hclickstein@penneyconstructioninc.com'
  );

  -- Field-only employees.
  INSERT INTO public.employees
    (first_name, last_name, email, title, hourly_rate, status, phone, created_by)
  SELECT v.first_name, v.last_name, v.email, v.title, v.hourly_rate,
         v.status::employee_status, v.phone, creator_id
  FROM (VALUES
    ('Wayne',      'Dobrosielski', 'wdobrosielski@penneyconstructioninc.com', 'Lead Carpenter', 55.00::numeric, 'active', NULL::text),
    ('Steven',     'Riley',        'sriley@penneyconstructioninc.com',        'Lead Carpenter', 38.00::numeric, 'active', '7819220556'),
    ('Mason',      'Clickstein',   'mclick@penneyconstructioninc.com',        'Runner',         NULL::numeric,  'active', NULL::text),
    ('Angel',      'Paulino',      'apaulino@penneyconstructioninc.com',      'Laborer',        22.00::numeric, 'active', NULL::text),
    ('Juan Pablo', 'Uribe',        NULL,                                      'Laborer',        28.00::numeric, 'active', NULL::text),
    ('Dylan',      'Wieselquist',  NULL,                                      'Laborer',        25.00::numeric, 'active', NULL::text)
  ) AS v(first_name, last_name, email, title, hourly_rate, status, phone)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.first_name = v.first_name AND e.last_name = v.last_name
  );
END $$;


-- ── Phase I: allowed_emails for field workers with known emails ──
-- So their Google login auto-claims the employee record (via trigger).

INSERT INTO public.allowed_emails (email, role, invited_by)
SELECT v.email, 'field', (SELECT id FROM public.profiles WHERE role = 'owner' LIMIT 1)
FROM (VALUES
  ('wdobrosielski@penneyconstructioninc.com'),
  ('sriley@penneyconstructioninc.com'),
  ('mclick@penneyconstructioninc.com'),
  ('apaulino@penneyconstructioninc.com'),
  ('hclickstein@penneyconstructioninc.com')
) AS v(email)
ON CONFLICT (email) DO NOTHING;


-- ── Phase J: owner-can-update-any-profile policy ──
-- Needed so Jorge / Ryan / Nicole / Shannon can edit other team members'
-- profiles through the /team UI. Individual users can still update their
-- own row via the existing "Users can update own profile" policy.

DROP POLICY IF EXISTS "Owner can update any profile" ON public.profiles;
CREATE POLICY "Owner can update any profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'owner')
  );

DROP POLICY IF EXISTS "Owner can update any employee" ON public.employees;
CREATE POLICY "Owner can update any employee"
  ON public.employees FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'owner')
  );
