-- ============================================================
-- 00068: Link employees → profiles (so workers can log in as
-- themselves and the daily-log + Today's-Work flow knows which
-- employee row matches the auth user)
-- ============================================================

alter table employees
  add column if not exists profile_id uuid references profiles(id) on delete set null;

create index if not exists idx_employees_profile_id on employees(profile_id);

-- Optional uniqueness — one employee row per profile. Comment out
-- if you ever need to support an admin user managing multiple
-- crew accounts.
create unique index if not exists uq_employees_profile_id
  on employees(profile_id) where profile_id is not null;
