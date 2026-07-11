-- Client meeting recorder (PM records client conversations per project).
-- Applied to the live DB on 2026-07-11.
create table if not exists public.project_meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text,
  meeting_date timestamptz not null default now(),
  attendees text,
  notes jsonb not null default '[]'::jsonb,
  summary text,
  action_items jsonb not null default '[]'::jsonb,
  status text not null default 'capturing' check (status in ('capturing','completed')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_meetings_project_idx
  on public.project_meetings (project_id, meeting_date desc);

alter table public.project_meetings enable row level security;

-- Visibility rides on projects RLS: PMs only see projects they're assigned
-- to, so the EXISTS scopes their meetings automatically.
create policy "Meetings visible with project" on public.project_meetings
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id));

create policy "Create meetings on visible projects" on public.project_meetings
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id)
  );

create policy "Update own meetings or owner" on public.project_meetings
  for update to authenticated
  using (
    created_by = auth.uid()
    or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'owner')
  );

create policy "Delete own meetings or owner" on public.project_meetings
  for delete to authenticated
  using (
    created_by = auth.uid()
    or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'owner')
  );
