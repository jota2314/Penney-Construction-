-- ============================================================
-- 00009: Site Visits (Project Documentation)
-- ============================================================

-- 1. Site visits table
create table public.site_visits (
  id uuid default gen_random_uuid() primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  visited_at timestamptz not null default now(),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  purpose text,
  summary text,
  created_by uuid references public.profiles(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_site_visits_project_id on public.site_visits(project_id);
create index idx_site_visits_status on public.site_visits(status);
create index idx_site_visits_visited_at on public.site_visits(visited_at);

-- 2. Site visit notes
create table public.site_visit_notes (
  id uuid default gen_random_uuid() primary key,
  site_visit_id uuid not null references public.site_visits(id) on delete cascade,
  content text not null,
  source text not null default 'typed' check (source in ('typed', 'voice')),
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_site_visit_notes_site_visit_id on public.site_visit_notes(site_visit_id);

-- 3. Site visit files (photos)
create table public.site_visit_files (
  id uuid default gen_random_uuid() primary key,
  site_visit_id uuid not null references public.site_visits(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size integer not null,
  mime_type text not null,
  caption text,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_site_visit_files_site_visit_id on public.site_visit_files(site_visit_id);

-- 4. RLS policies (all authenticated users can do everything)
alter table public.site_visits enable row level security;
alter table public.site_visit_notes enable row level security;
alter table public.site_visit_files enable row level security;

-- Site visits
create policy "Authenticated users can view site visits"
  on public.site_visits for select to authenticated using (true);
create policy "Authenticated users can insert site visits"
  on public.site_visits for insert to authenticated with check (true);
create policy "Authenticated users can update site visits"
  on public.site_visits for update to authenticated using (true);
create policy "Authenticated users can delete site visits"
  on public.site_visits for delete to authenticated using (true);

-- Site visit notes
create policy "Authenticated users can view site visit notes"
  on public.site_visit_notes for select to authenticated using (true);
create policy "Authenticated users can insert site visit notes"
  on public.site_visit_notes for insert to authenticated with check (true);
create policy "Authenticated users can update site visit notes"
  on public.site_visit_notes for update to authenticated using (true);
create policy "Authenticated users can delete site visit notes"
  on public.site_visit_notes for delete to authenticated using (true);

-- Site visit files
create policy "Authenticated users can view site visit files"
  on public.site_visit_files for select to authenticated using (true);
create policy "Authenticated users can insert site visit files"
  on public.site_visit_files for insert to authenticated with check (true);
create policy "Authenticated users can delete site visit files"
  on public.site_visit_files for delete to authenticated using (true);
