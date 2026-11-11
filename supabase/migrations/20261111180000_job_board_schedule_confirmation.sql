-- Job Board: who last confirmed a job's schedule, and when.
-- Additive and nullable. The simpler board reads these to show one status per
-- job; "Confirm schedule" in the Update sheet writes them.
alter table public.projects
  add column if not exists schedule_confirmed_at timestamptz,
  add column if not exists schedule_confirmed_by uuid references public.profiles(id) on delete set null;

comment on column public.projects.schedule_confirmed_at is 'Job Board: when the schedule was last confirmed as right by a person.';
comment on column public.projects.schedule_confirmed_by is 'Job Board: profile that last confirmed the schedule.';
