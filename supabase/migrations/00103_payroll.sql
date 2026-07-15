-- Payroll timesheet support.
--
-- Field time lives in `daily_logs`. Payroll rolls those up per worker per day
-- and subtracts a break (default 30 min/day, overridable per person/day). This
-- table stores only the overrides; the default is applied in the app.
create table if not exists public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  break_minutes integer not null default 30 check (break_minutes >= 0 and break_minutes <= 720),
  note text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (profile_id, work_date)
);

alter table public.payroll_adjustments enable row level security;

-- Payroll is office-sensitive: only owner + office_admin may read/write.
-- (Server actions also gate by role and use the service-role client; this is
-- defense-in-depth against direct PostgREST access.)
drop policy if exists payroll_adjustments_read on public.payroll_adjustments;
create policy payroll_adjustments_read on public.payroll_adjustments
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','office_admin'))
  );

drop policy if exists payroll_adjustments_write on public.payroll_adjustments;
create policy payroll_adjustments_write on public.payroll_adjustments
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','office_admin'))
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','office_admin'))
  );

-- Audit trail for manual clock-time corrections made from the payroll screen.
alter table public.daily_logs add column if not exists edited_by uuid references public.profiles(id) on delete set null;
alter table public.daily_logs add column if not exists edited_at timestamptz;
