-- Manual per-file overrides for the project Files tab: re-file a document into
-- a different category and/or give it a friendly display name. Keyed by the
-- same canonical identity (lowercased filename|size) the tab uses for dedup
-- and dismissal, so one override covers every copy of the same physical file
-- (email attachment + promoted project_files row).
create table if not exists public.project_file_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  file_key text not null,
  category text,
  display_name text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (project_id, file_key)
);

alter table public.project_file_overrides enable row level security;

create policy project_file_overrides_select on public.project_file_overrides
  for select to authenticated using (true);
create policy project_file_overrides_insert on public.project_file_overrides
  for insert to authenticated with check (true);
create policy project_file_overrides_update on public.project_file_overrides
  for update to authenticated using (true) with check (true);
create policy project_file_overrides_delete on public.project_file_overrides
  for delete to authenticated using (true);
