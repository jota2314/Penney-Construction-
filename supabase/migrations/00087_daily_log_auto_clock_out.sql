-- Forgot-to-clock-out support: a flag marking logs the system auto-closed
-- because the worker never clocked out and the shift was capped at the 12h max.
alter table public.daily_logs
  add column if not exists auto_clocked_out boolean not null default false;

comment on column public.daily_logs.auto_clocked_out is
  'True when the system auto-closed this log because the worker forgot to clock out (shift exceeded the 12h max and was capped).';
