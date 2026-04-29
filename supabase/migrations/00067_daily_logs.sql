-- ============================================================
-- 00067: Daily Logs (field-worker clock-in/out + IG-style posts)
-- ============================================================
-- A daily_logs row represents one worker's day on one phase.
-- Created on clock-in (started_at = now, ended_at = null).
-- Finalized on clock-out (ended_at = now, text + photos added).
-- Visible to all authenticated users (social feed style).

-- 1. Storage bucket for daily-log photos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'daily-log-photos',
  'daily-log-photos',
  false,
  10485760, -- 10MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create policy "Authenticated users can upload daily-log photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'daily-log-photos');

create policy "Authenticated users can read daily-log photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'daily-log-photos');

create policy "Authenticated users can delete daily-log photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'daily-log-photos');

-- 2. daily_logs table
create table daily_logs (
  id                    uuid primary key default gen_random_uuid(),
  schedule_phase_id     uuid not null references schedule_phases(id) on delete cascade,
  author_id             uuid not null references profiles(id) on delete cascade,
  text                  text,
  photo_storage_paths   text[] not null default '{}',
  status                text not null default 'in_progress' check (status in ('in_progress','completed')),
  started_at            timestamptz not null default now(),
  ended_at              timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_daily_logs_phase   on daily_logs(schedule_phase_id);
create index idx_daily_logs_author  on daily_logs(author_id);
create index idx_daily_logs_started on daily_logs(started_at desc);
create index idx_daily_logs_status  on daily_logs(status);

-- 3. RLS — visible to all, but only author can insert/update their own
alter table daily_logs enable row level security;

create policy "Authenticated users can read daily logs"
  on daily_logs for select to authenticated
  using (true);

create policy "Authors can insert their own daily logs"
  on daily_logs for insert to authenticated
  with check (author_id = auth.uid());

create policy "Authors can update their own daily logs"
  on daily_logs for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- 4. Maintain updated_at (immutable search_path for the trigger function)
create or replace function set_daily_logs_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_daily_logs_updated_at
  before update on daily_logs
  for each row
  execute function set_daily_logs_updated_at();
