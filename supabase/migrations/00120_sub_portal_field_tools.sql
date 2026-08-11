-- Subs can now clock in/out and post daily logs from the sub portal.
-- daily_logs rows authored by a subcontractor carry subcontractor_id and no
-- author_id (subs have no profiles). One of the two must be present.
alter table public.daily_logs alter column author_id drop not null;

alter table public.daily_logs
  add column if not exists subcontractor_id uuid references public.subcontractors(id) on delete set null;

alter table public.daily_logs
  add constraint daily_logs_author_or_sub_check
  check (author_id is not null or subcontractor_id is not null);

create index if not exists idx_daily_logs_subcontractor
  on public.daily_logs (subcontractor_id) where subcontractor_id is not null;

-- Sub-portal quote uploads have no signed-in profile behind them.
alter table public.quote_requests alter column created_by drop not null;
