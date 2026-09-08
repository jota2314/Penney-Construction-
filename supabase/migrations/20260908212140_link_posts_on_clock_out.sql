-- A worker can post their daily write-up immediately BEFORE clock-out.
-- The composer only offers closed shifts, so that write-up is a standalone
-- post. Reconcile at either edge (post or clock-out), in the same transaction.
-- No historical backfill: only the author/job/day of the changed row is touched.
create or replace function public.link_posted_shift_report()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  work_day date;
  latest_start timestamptz;
  report_id uuid;
  posted_at timestamptz;
begin
  if new.project_id is null then return new; end if;
  if new.report_required then
    if new.status <> 'completed' or new.ended_at is null
      or new.ended_at <= new.started_at or new.report_submitted_at is not null then
      return new;
    end if;
    -- Ignore edits made by submit_shift_daily_report and ordinary time edits.
    if tg_op = 'UPDATE' and old.status <> 'in_progress' then return new; end if;
  elsif new.status <> 'completed' or new.ended_at is distinct from new.started_at
    or nullif(btrim(new.text), '') is null or new.subcontractor_id is not null then
    return new;
  end if;

  work_day := (new.started_at at time zone 'America/New_York')::date;
  perform pg_advisory_xact_lock(hashtextextended(
    new.author_id::text || new.project_id::text || work_day::text, 0));
  -- Do not complete a day's report while the worker is still on this job.
  if exists (select 1 from public.daily_logs
    where author_id = new.author_id and project_id = new.project_id
      and (started_at at time zone 'America/New_York')::date = work_day
      and status = 'in_progress') then return new; end if;

  select max(started_at) into latest_start from public.daily_logs
    where author_id = new.author_id and project_id = new.project_id
      and (started_at at time zone 'America/New_York')::date = work_day
      and report_required and report_submitted_at is null
      and status = 'completed' and ended_at > started_at;
  if latest_start is null then return new; end if;

  -- Require a written update from this worker, job and Eastern workday.
  -- A later visit needs a fresh update; an earlier report cannot satisfy it.
  -- Duration, not kind, also recognizes posts from older clients that omitted
  -- kind and inherited the database's 'shift' default.
  select id, created_at into report_id, posted_at from public.daily_logs
    where author_id = new.author_id and project_id = new.project_id
      and (started_at at time zone 'America/New_York')::date = work_day
      and not report_required and status = 'completed' and ended_at = started_at
      and started_at >= latest_start and nullif(btrim(text), '') is not null
      and subcontractor_id is null
    order by started_at desc, id limit 1;
  if report_id is null then return new; end if;

  update public.daily_logs set daily_report_id = report_id,
      report_submitted_at = posted_at
    where author_id = new.author_id and project_id = new.project_id
      and (started_at at time zone 'America/New_York')::date = work_day
      and report_required and report_submitted_at is null
      and status = 'completed' and ended_at > started_at;
  return new;
end;
$$;
revoke all on function public.link_posted_shift_report() from public, anon, authenticated;
create trigger link_posted_shift_report
  after insert or update of status, ended_at, text on public.daily_logs
  for each row execute function public.link_posted_shift_report();

-- Deleting a linked standalone report must make its shifts due again.
create or replace function public.reopen_deleted_shift_report()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  update public.daily_logs set daily_report_id = null, report_submitted_at = null
    where daily_report_id = old.id and id <> old.id;
  return old;
end;
$$;
revoke all on function public.reopen_deleted_shift_report() from public, anon, authenticated;
create trigger reopen_deleted_shift_report before delete on public.daily_logs
  for each row execute function public.reopen_deleted_shift_report();
