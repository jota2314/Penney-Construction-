-- ============================================================
-- 00006: Project Files Storage + Estimate Files Table
-- ============================================================

-- 1. Create private storage bucket for project files
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files',
  'project-files',
  false,
  10485760,  -- 10MB
  array['image/jpeg', 'image/png', 'image/webp']
);

-- 2. Storage RLS policies: authenticated users can upload, read, delete
create policy "Authenticated users can upload project files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files');

create policy "Authenticated users can read project files"
  on storage.objects for select to authenticated
  using (bucket_id = 'project-files');

create policy "Authenticated users can delete project files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'project-files');

-- 3. Create estimate_files table
create table estimate_files (
  id           uuid primary key default gen_random_uuid(),
  estimate_id  uuid not null references estimates(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  file_size    integer not null,
  mime_type    text not null,
  uploaded_by  uuid not null references auth.users(id),
  created_at   timestamptz default now()
);

-- Index for fast lookups by estimate
create index idx_estimate_files_estimate_id on estimate_files(estimate_id);

-- 4. RLS on estimate_files: authenticated users can do everything (small team)
alter table estimate_files enable row level security;

create policy "Authenticated users can read estimate files"
  on estimate_files for select to authenticated
  using (true);

create policy "Authenticated users can insert estimate files"
  on estimate_files for insert to authenticated
  with check (true);

create policy "Authenticated users can delete estimate files"
  on estimate_files for delete to authenticated
  using (true);
