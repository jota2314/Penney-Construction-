-- ══════════════════════════════════════════════════
-- Migration 00061: Extend profiles.role enum to 5 values
-- ══════════════════════════════════════════════════
-- The TypeScript UserRole type defines 5 roles but the initial schema
-- CHECK constraint only allows 3. Align DB with TS.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner', 'precon_manager', 'project_manager', 'office_admin', 'field'));
