-- ══════════════════════════════════════════════════
-- Migration 00064: Custom team-member profiles
-- ══════════════════════════════════════════════════
-- Adds a single table that holds the rich, editable profile fields for
-- both `profiles` rows (people who sign in via Google) and `employees`
-- rows (field workers who only clock in). Fields like bio, avatar, trades,
-- certifications, languages, etc. live here so we don't bloat either of
-- the two source tables.
--
-- One row per person — keyed by profile_id OR employee_id. A person who
-- has both (e.g. Jorge has a profile and an employee row) gets one
-- combined row keyed by profile_id; the link to employee is via
-- employees.profile_id which already exists.
--
-- Fully idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.team_member_profile (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  bio text,
  avatar_url text,
  pronouns text,
  trades text[] NOT NULL DEFAULT '{}',
  certifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  languages text[] NOT NULL DEFAULT '{}',
  years_experience integer,
  hire_date date,
  emergency_contact jsonb,
  notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  visible_to_clients boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((profile_id IS NOT NULL) OR (employee_id IS NOT NULL))
);

-- One profile row per profile_id, one per employee_id (when set).
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_member_profile_profile_id
  ON public.team_member_profile(profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_member_profile_employee_id
  ON public.team_member_profile(employee_id) WHERE employee_id IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_team_member_profile_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_team_member_profile_updated_at
  ON public.team_member_profile;
CREATE TRIGGER trg_team_member_profile_updated_at
  BEFORE UPDATE ON public.team_member_profile
  FOR EACH ROW EXECUTE FUNCTION public.set_team_member_profile_updated_at();

-- RLS
ALTER TABLE public.team_member_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view team_member_profile"
  ON public.team_member_profile;
CREATE POLICY "Authenticated users can view team_member_profile"
  ON public.team_member_profile FOR SELECT
  TO authenticated USING (true);

-- A user can update their own profile (matched by profile_id = auth.uid()).
DROP POLICY IF EXISTS "Users can update own team_member_profile"
  ON public.team_member_profile;
CREATE POLICY "Users can update own team_member_profile"
  ON public.team_member_profile FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- A user can insert their own profile.
DROP POLICY IF EXISTS "Users can insert own team_member_profile"
  ON public.team_member_profile;
CREATE POLICY "Users can insert own team_member_profile"
  ON public.team_member_profile FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());

-- Owner can do anything (insert, update, delete) for any team member,
-- including profiles for employees that have no auth account.
DROP POLICY IF EXISTS "Owner can manage team_member_profile"
  ON public.team_member_profile;
CREATE POLICY "Owner can manage team_member_profile"
  ON public.team_member_profile FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner')
  );

-- Helpful indexes for the team page query.
CREATE INDEX IF NOT EXISTS idx_team_member_profile_trades
  ON public.team_member_profile USING gin(trades);
