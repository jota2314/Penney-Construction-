-- Preserve historical reports. New reports require explicit worker progress.
alter table public.daily_logs add column report_progress jsonb;
create or replace function public.valid_daily_report_progress(p jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(jsonb_typeof(p)='object'
    and p->>'status' in ('remaining','finished')
    and jsonb_typeof(p->'remaining')='string'
    and jsonb_typeof(p->'timeNeeded')='string'
    and jsonb_typeof(p->'blockers')='string'
    and length(btrim(p->>'blockers')) between 1 and 1500
    and length(p->>'remaining') <= 1500 and length(p->>'timeNeeded') <= 200
    and (p->>'status'='finished' or
      (length(btrim(p->>'remaining'))>0 and length(btrim(p->>'timeNeeded'))>0)),false);
$$;
revoke all on function public.valid_daily_report_progress(jsonb) from public,anon;
grant execute on function public.valid_daily_report_progress(jsonb) to authenticated;
alter table public.daily_logs add constraint daily_logs_report_progress_valid
  check (report_progress is null or public.valid_daily_report_progress(report_progress));
-- Replace the old signature, preserving its RLS and author checks.
drop function public.submit_shift_daily_report(uuid,uuid,text,text[],jsonb,uuid[]);

create or replace function public.submit_shift_daily_report(
  p_author uuid, p_log_id uuid, p_text text, p_photos text[], p_tags jsonb, p_mentions uuid[], p_progress jsonb default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  anchor public.daily_logs;
  work_day date;
  previous_report uuid;
begin
  if auth.uid() is null or (auth.uid() <> p_author and not exists (
    select 1 from public.profiles where id=auth.uid()
      and role in ('owner','precon_manager','office_admin','project_manager')
  )) then raise exception 'Not allowed to submit this worker''s report'; end if;
  if not public.valid_daily_report_progress(p_progress) then
    raise exception 'Choose task status and fill in remaining work, time needed and blockers. Refresh the app if these fields are missing.';
  end if;
  if length(btrim(coalesce(p_text,''))) = 0 or length(p_text) > 20000 then
    raise exception 'Describe finished work, remaining work and blockers in your daily log';
  end if;
  select * into anchor from public.daily_logs where id=p_log_id and author_id=p_author;
  if not found or not anchor.report_required or anchor.project_id is null
    or anchor.status <> 'completed' or anchor.ended_at is null or anchor.ended_at <= anchor.started_at then
    raise exception 'Choose a clocked-out workday for your daily log';
  end if;
  work_day := (anchor.started_at at time zone 'America/New_York')::date;
  perform pg_advisory_xact_lock(hashtextextended(p_author::text || anchor.project_id::text || work_day::text,0));
  select * into anchor from public.daily_logs where id=p_log_id and author_id=p_author for update;
  if anchor.report_submitted_at is not null then return coalesce(anchor.daily_report_id,anchor.id); end if;
  if exists(select 1 from public.daily_logs where author_id=p_author and project_id=anchor.project_id
      and (started_at at time zone 'America/New_York')::date=work_day and status='in_progress') then
    raise exception 'Clock out of this job before submitting the daily log';
  end if;
  -- A later same-day visit extends the same report rather than making another.
  select id into previous_report from public.daily_logs
    where author_id=p_author and project_id=anchor.project_id and daily_report_id=id
      and report_submitted_at is not null
      and (started_at at time zone 'America/New_York')::date=work_day
    order by started_at limit 1;
  if previous_report is not null then anchor.id := previous_report; end if;
  update public.daily_logs set
    report_progress=p_progress,
    text=concat_ws(E'\n\n',nullif(text,''),'Daily log — ' || work_day::text || E'\n' || btrim(p_text)),
    photo_storage_paths=coalesce(photo_storage_paths,'{}'::text[]) || coalesce(p_photos,'{}'::text[]),
    tagged_entities=coalesce(tagged_entities,'[]'::jsonb) || coalesce(p_tags,'[]'::jsonb),
    mentioned_profile_ids=coalesce(mentioned_profile_ids,'{}'::uuid[]) || coalesce(p_mentions,'{}'::uuid[])
    where id=anchor.id and author_id=p_author;
  update public.daily_logs set report_submitted_at=now(),daily_report_id=anchor.id
    where author_id=p_author and project_id=anchor.project_id and report_required
      and report_submitted_at is null and status='completed' and ended_at>started_at
      and (started_at at time zone 'America/New_York')::date=work_day;
  return anchor.id;
end;
$$;
revoke all on function public.submit_shift_daily_report(uuid,uuid,text,text[],jsonb,uuid[],jsonb) from public,anon;
grant execute on function public.submit_shift_daily_report(uuid,uuid,text,text[],jsonb,uuid[],jsonb) to authenticated;

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
      and public.valid_daily_report_progress(report_progress)
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
