-- One row per person per training test (e.g. the PM change-order test at
-- /guides/pm-test). The page scores on the server and writes with the service
-- role, so there are deliberately NO insert/update/delete policies: a taker
-- can read their own result but can never write or change a score.
-- Applied live 2026-11-10 as version 20261110124044.
create table if not exists public.training_test_attempts (
  id uuid primary key default gen_random_uuid(),
  test_key text not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  taker_name text,
  project_id uuid references public.projects(id) on delete set null,
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'graded' check (status in ('graded', 'needs_grading')),
  score numeric,
  max_score numeric not null default 100,
  breakdown jsonb,
  submitted_at timestamptz not null default now(),
  graded_at timestamptz,
  unique (test_key, profile_id)
);

alter table public.training_test_attempts enable row level security;

drop policy if exists "Own attempt or guide editors read" on public.training_test_attempts;
create policy "Own attempt or guide editors read"
  on public.training_test_attempts
  for select
  to authenticated
  using (profile_id = (select auth.uid()) or public.can_edit_how_to_guides());

comment on table public.training_test_attempts is
  'Training test results (PM change-order test). Written only by the server with the service role; takers read their own row, Jorge and Ryan read all.';
