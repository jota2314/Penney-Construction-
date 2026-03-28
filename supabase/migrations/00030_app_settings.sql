-- App Settings table — stores API keys and config
-- Keys are stored server-side only, protected by RLS

create table if not exists app_settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table app_settings enable row level security;

create policy "Authenticated users can read settings"
  on app_settings for select to authenticated using (true);

create policy "Authenticated users can manage settings"
  on app_settings for all to authenticated using (true) with check (true);
