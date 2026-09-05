-- Existing closed history is exempt. New shifts require a report after clock-out.
alter table public.daily_logs add column if not exists report_required boolean not null default false;
alter table public.daily_logs add column if not exists report_submitted_at timestamptz;
alter table public.daily_logs add column if not exists daily_report_id uuid references public.daily_logs(id) on delete set null;
create index if not exists daily_logs_pending_report on public.daily_logs(author_id, started_at)
  where report_required and report_submitted_at is null;

-- Attach the daily report to an existing shift, retaining all time/line-item records.
-- RLS remains in force, including the app's existing manager impersonation rules.
create or replace function public.submit_shift_daily_report(
  p_author uuid, p_log_id uuid, p_text text, p_photos text[], p_tags jsonb, p_mentions uuid[]
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
revoke all on function public.submit_shift_daily_report(uuid,uuid,text,text[],jsonb,uuid[]) from public,anon;
grant execute on function public.submit_shift_daily_report(uuid,uuid,text,text[],jsonb,uuid[]) to authenticated;
