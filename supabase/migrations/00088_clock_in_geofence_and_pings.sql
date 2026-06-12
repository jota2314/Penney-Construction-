-- Geofenced clock-in: stamp where the worker was when they punched in, and
-- whether that was within the job-site geofence.
alter table public.daily_logs
  add column if not exists clock_in_lat double precision,
  add column if not exists clock_in_lng double precision,
  add column if not exists clock_in_accuracy double precision,
  add column if not exists clock_in_distance_m double precision,
  add column if not exists clock_in_on_site boolean;

-- Presence pings: an opportunistic location fix captured each time the worker
-- opens the app while clocked in (foreground sampling — no background tracking).
create table if not exists public.daily_log_pings (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references public.daily_logs(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  distance_m double precision,
  on_site boolean,
  captured_at timestamptz not null default now()
);
create index if not exists daily_log_pings_log_idx on public.daily_log_pings(daily_log_id);
create index if not exists daily_log_pings_captured_idx on public.daily_log_pings(captured_at);

alter table public.daily_log_pings enable row level security;

drop policy if exists "auth read daily_log_pings" on public.daily_log_pings;
create policy "auth read daily_log_pings" on public.daily_log_pings
  for select to authenticated using (true);

drop policy if exists "auth insert daily_log_pings" on public.daily_log_pings;
create policy "auth insert daily_log_pings" on public.daily_log_pings
  for insert to authenticated with check (true);
