-- Keep field evidence linked to master work, with a separate office verification.
alter table public.schedule_phases add column if not exists master_phase_id uuid references public.schedule_phases(id) on delete set null;
alter table public.daily_logs add column if not exists master_phase_id uuid references public.schedule_phases(id) on delete set null;
create index if not exists schedule_phases_master_phase_idx on public.schedule_phases(master_phase_id) where master_phase_id is not null;
create index if not exists daily_logs_master_phase_idx on public.daily_logs(master_phase_id) where master_phase_id is not null;

create or replace function public.is_master_schedule_phase(p public.schedule_phases)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(p.phase_scope,'master')='master' and coalesce(p.event_type,'') not in ('crew','clock_in','clockin') and coalesce(p.name,'') !~* '^clock[ -]?in\y';
$$;

create or replace function public.can_review_schedule()
returns boolean language sql stable security invoker set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and role in ('owner','precon_manager','office_admin','project_manager'));
$$;
revoke all on function public.can_review_schedule() from public,anon;
grant execute on function public.can_review_schedule() to authenticated,service_role;

create table public.schedule_progress_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  daily_log_id uuid not null references public.daily_logs(id),
  master_phase_id uuid references public.schedule_phases(id) on delete set null,
  evidence_updated_at timestamptz not null,
  reviewed_by uuid not null references public.profiles(id),
  note text not null check(length(btrim(note)) between 1 and 2000),
  before_phase jsonb,
  after_phase jsonb,
  created_at timestamptz not null default now(),
  unique(daily_log_id,evidence_updated_at)
);
alter table public.schedule_progress_reviews enable row level security;
grant select,insert on public.schedule_progress_reviews to authenticated;
grant all on public.schedule_progress_reviews to service_role;
create policy "Office reads field verification" on public.schedule_progress_reviews for select to authenticated using(public.can_review_schedule());
create policy "Office records field verification" on public.schedule_progress_reviews for insert to authenticated with check(public.can_review_schedule() and reviewed_by=auth.uid());

-- Validate both explicit links and inherit a known dispatch link on new reports.
create or replace function public.validate_master_work_link()
returns trigger language plpgsql security invoker set search_path='' as $$
declare parent public.schedule_phases; dispatch public.schedule_phases;
begin
  if tg_table_name='daily_logs' then
    if tg_op='INSERT' and new.schedule_phase_id is not null then
      select * into dispatch from public.schedule_phases where id=new.schedule_phase_id;
      -- Legacy writers only supplied schedule_phase_id. Its project is an
      -- explicit relationship, so inherit it before validating the master link.
      if new.project_id is null then new.project_id=dispatch.project_id; end if;
      if new.master_phase_id is null then
        if public.is_master_schedule_phase(dispatch) then new.master_phase_id=dispatch.id;
        else new.master_phase_id=dispatch.master_phase_id; end if;
      end if;
    end if;
  end if;
  if new.master_phase_id is not null then
    select * into parent from public.schedule_phases where id=new.master_phase_id;
    if parent.id is null or parent.project_id is distinct from new.project_id or not public.is_master_schedule_phase(parent) then
      raise exception 'Choose a master phase from the same project.';
    end if;
    if tg_table_name='schedule_phases' then
    if new.id=new.master_phase_id or public.is_master_schedule_phase(new) then
      raise exception 'Only daily work can link to a master phase.';
    end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger validate_daily_master_link before insert or update of master_phase_id,project_id on public.daily_logs for each row execute function public.validate_master_work_link();
create trigger validate_dispatch_master_link before insert or update of master_phase_id,project_id,phase_scope,event_type on public.schedule_phases for each row execute function public.validate_master_work_link();

-- One transaction: verify evidence freshness, link the dispatch/report, update
-- only the chosen master task, and retain exactly what the reviewer approved.
create or replace function public.review_schedule_field_progress(
  p_log_id uuid, p_phase_id uuid, p_evidence_updated_at timestamptz,
  p_phase_updated_at timestamptz, p_status text, p_end_date date, p_note text,
  p_forecast_start date default null, p_forecast_end date default null
) returns uuid language plpgsql security invoker set search_path='' as $$
declare evidence public.daily_logs; phase public.schedule_phases; after_phase public.schedule_phases; review_id uuid;
begin
  if not public.can_review_schedule() then raise exception 'Office schedule access required.'; end if;
  if length(btrim(coalesce(p_note,''))) not between 1 and 2000 then raise exception 'Add a verification note (up to 2,000 characters).'; end if;
  select * into evidence from public.daily_logs where id=p_log_id for update;
  if evidence.id is null or evidence.project_id is null then raise exception 'This report is unavailable.'; end if;
  if evidence.updated_at is distinct from p_evidence_updated_at then raise exception 'The field report changed. Reload before reviewing.'; end if;
  if exists(select 1 from public.schedule_progress_reviews where daily_log_id=p_log_id and evidence_updated_at=p_evidence_updated_at) then
    raise exception 'This version of the report was already reviewed. Reload.';
  end if;
  if p_phase_id is not null then
    select * into phase from public.schedule_phases where id=p_phase_id for update;
    if phase.id is null or phase.project_id is distinct from evidence.project_id or not public.is_master_schedule_phase(phase) then raise exception 'Choose a master phase from this project.'; end if;
    if phase.updated_at is distinct from p_phase_updated_at then raise exception 'The phase changed. Reload before reviewing.'; end if;
    if phase.event_type='inspection' and (p_status is not null or p_end_date is not null) then raise exception 'Record inspection results in Inspections.'; end if;
    if p_status is not null and p_status not in ('not_started','in_progress','completed','on_hold') then raise exception 'Invalid phase status.'; end if;
    if (p_forecast_start is null) <> (p_forecast_end is null) or p_forecast_end < p_forecast_start then raise exception 'Invalid forecast dates.'; end if;
    if p_forecast_start is not null and (phase.event_type='inspection' or phase.status in ('in_progress','completed') or coalesce(phase.is_confirmed,false) or coalesce(phase.is_manually_scheduled,false) or (coalesce(p_status,'') not in ('in_progress','completed') and p_end_date is null)) then raise exception 'This phase no longer needs a forecast snapshot. Reload.'; end if;
    if p_end_date is not null and p_end_date < coalesce(p_forecast_start,phase.start_date) then raise exception 'The finish date cannot precede the start.'; end if;
    update public.schedule_phases set
      status=case when p_status is null then status else p_status::public.schedule_phase_status end,
      start_date=coalesce(p_forecast_start,start_date),
      end_date=coalesce(p_end_date,p_forecast_end,end_date),
      is_manually_scheduled=case when p_end_date is not null or p_forecast_start is not null then true else is_manually_scheduled end
    where id=p_phase_id returning * into after_phase;
    update public.schedule_phases set master_phase_id=p_phase_id
      where id=evidence.schedule_phase_id and project_id=evidence.project_id and not public.is_master_schedule_phase(schedule_phases);
  elsif p_status is not null or p_end_date is not null or p_forecast_start is not null or p_forecast_end is not null then
    raise exception 'Choose a master phase before changing progress.';
  end if;
  -- Do not rewrite daily_logs: that would change evidence.updated_at and queue
  -- the same report again. The review is the immutable report-to-master link.
  insert into public.schedule_progress_reviews(project_id,daily_log_id,master_phase_id,evidence_updated_at,reviewed_by,note,before_phase,after_phase)
    values(evidence.project_id,p_log_id,p_phase_id,p_evidence_updated_at,auth.uid(),btrim(p_note),case when phase.id is not null then to_jsonb(phase) end,case when after_phase.id is not null then to_jsonb(after_phase) end)
    returning id into review_id;
  return review_id;
end;
$$;
revoke all on function public.review_schedule_field_progress(uuid,uuid,timestamptz,timestamptz,text,date,text,date,date) from public,anon;
grant execute on function public.review_schedule_field_progress(uuid,uuid,timestamptz,timestamptz,text,date,text,date,date) to authenticated;

-- A client report is evidence for office review, not a verified completion.
-- Re-check both versions under the row lock so a withdrawn report or a newer
-- office change cannot be overwritten by an old browser tab.
create or replace function public.verify_client_schedule_progress(
  p_phase_id uuid, p_phase_updated_at timestamptz,
  p_client_completed_at timestamptz, p_note text,
  p_forecast_start date default null, p_forecast_end date default null
) returns void language plpgsql security invoker set search_path='' as $$
declare phase public.schedule_phases;
begin
  if not public.can_review_schedule() then raise exception 'Office schedule access required.'; end if;
  if length(btrim(coalesce(p_note,''))) not between 1 and 2000 then raise exception 'Add a verification note (up to 2,000 characters).'; end if;
  select * into phase from public.schedule_phases where id=p_phase_id for update;
  if phase.id is null or not public.is_master_schedule_phase(phase) then raise exception 'Choose a master phase.'; end if;
  if phase.event_type='inspection' then raise exception 'Record inspection results in Inspections.'; end if;
  if phase.updated_at is distinct from p_phase_updated_at or phase.client_completed_at is null or
      phase.client_completed_at is distinct from p_client_completed_at then
    raise exception 'The client report or phase changed. Reload before verifying.';
  end if;
  if phase.status='completed' then raise exception 'This phase is already verified complete. Reload.'; end if;
  if (p_forecast_start is null) <> (p_forecast_end is null) or p_forecast_end < p_forecast_start then raise exception 'Invalid forecast dates.'; end if;
  if p_forecast_start is not null and (phase.status='in_progress' or coalesce(phase.is_confirmed,false) or coalesce(phase.is_manually_scheduled,false)) then raise exception 'This phase no longer needs a forecast snapshot. Reload.'; end if;
  update public.schedule_phases set status='completed',
    start_date=coalesce(p_forecast_start,start_date),end_date=coalesce(p_forecast_end,end_date),
    is_manually_scheduled=case when p_forecast_start is not null then true else is_manually_scheduled end where id=p_phase_id;
  insert into public.activity_log(user_id,action,entity_type,entity_id,details)
    values(auth.uid(),'client_schedule_progress_verified','schedule_phase',p_phase_id,
      jsonb_build_object('project_id',phase.project_id,'before',phase.status,'after','completed',
        'client_completed_at',p_client_completed_at,'evidence_updated_at',p_phase_updated_at,'note',btrim(p_note)));
end;
$$;
revoke all on function public.verify_client_schedule_progress(uuid,timestamptz,timestamptz,text,date,date) from public,anon;
grant execute on function public.verify_client_schedule_progress(uuid,timestamptz,timestamptz,text,date,date) to authenticated;

-- Physical lifecycle changes cannot approve financial documents.
create or replace function public.sync_estimate_status_on_project_change()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status is distinct from old.status and new.status in ('proposal_sent','contracted') then
    update public.estimates set status='approved' where project_id=new.id and status='draft';
  end if;
  return new;
end;
$$;

create or replace function public.reconcile_project_schedule(p_project_id uuid,p_expected_status text,p_next_status text)
returns void language plpgsql security invoker set search_path='' as $$
declare job public.projects; total bigint; done bigint;
begin
  if not public.can_review_schedule() then raise exception 'Office schedule access required.'; end if;
  select * into job from public.projects where id=p_project_id for update;
  if job.id is null or job.status::text is distinct from p_expected_status then raise exception 'The project changed. Reload before updating.'; end if;
  if p_next_status not in ('in_progress','completed') then raise exception 'Choose started or completed.'; end if;
  select count(*),count(*) filter(where status='completed') into total,done from public.schedule_phases where project_id=p_project_id and public.is_master_schedule_phase(schedule_phases);
  if p_next_status='completed' and (total=0 or done<>total or exists(select 1 from public.project_inspections where project_id=p_project_id and status<>'passed')) then
    raise exception 'Verify every master phase and inspection before completing this project.';
  end if;
  update public.projects set status=p_next_status,
    phase=case when p_next_status='completed' then 'complete'::public.project_phase
      when phase='complete' then null else phase end,
    progress=case when total>0 then round(100.0*done/total)::integer else 0 end where id=p_project_id;
  insert into public.activity_log(user_id,action,entity_type,entity_id,details)
    values(auth.uid(),'schedule_lifecycle_reconciled','project',p_project_id,jsonb_build_object('before',job.status,'after',p_next_status,'verified_master',done,'total_master',total));
end;
$$;
revoke all on function public.reconcile_project_schedule(uuid,text,text) from public,anon;
grant execute on function public.reconcile_project_schedule(uuid,text,text) to authenticated;

-- Keep the stored project percentage in step with the shared UI measure.
-- Deliberately never infer physical completion or approve an estimate here.
create or replace function public.refresh_verified_schedule_progress()
returns trigger language plpgsql security invoker set search_path='' as $$
declare job_id uuid; total bigint; done bigint;
begin
  for job_id in select distinct id from unnest(array[case when tg_op<>'INSERT' then old.project_id end,case when tg_op<>'DELETE' then new.project_id end]) ids(id) where id is not null loop
    perform 1 from public.projects where id=job_id for update;
    select count(*),count(*) filter(where status='completed') into total,done from public.schedule_phases where project_id=job_id and public.is_master_schedule_phase(schedule_phases);
    update public.projects set progress=case when total>0 then round(100.0*done/total)::integer else null end
      where id=job_id and progress is distinct from case when total>0 then round(100.0*done/total)::integer else null end;
  end loop;
  return null;
end;
$$;
create trigger refresh_verified_schedule_progress after insert or delete or update of project_id,status,phase_scope,event_type,name on public.schedule_phases for each row execute function public.refresh_verified_schedule_progress();

create or replace function public.audit_schedule_progress_change()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is not null and (old.status is distinct from new.status or old.start_date is distinct from new.start_date or old.end_date is distinct from new.end_date) then
    insert into public.activity_log(user_id,action,entity_type,entity_id,details) values(auth.uid(),'schedule_updated','schedule_phase',new.id,jsonb_build_object('project_id',new.project_id,'before',jsonb_build_object('status',old.status,'start_date',old.start_date,'end_date',old.end_date),'after',jsonb_build_object('status',new.status,'start_date',new.start_date,'end_date',new.end_date)));
  end if;
  return null;
end;
$$;
create trigger audit_schedule_progress_change after update of status,start_date,end_date on public.schedule_phases for each row execute function public.audit_schedule_progress_change();

-- Recompute percentages only; no historical dates/statuses or financial rows.
update public.projects p set progress=(select case when count(*)>0 then round(100.0*count(*) filter(where s.status='completed')/count(*))::integer else null end from public.schedule_phases s where s.project_id=p.id and public.is_master_schedule_phase(s))
where exists(select 1 from public.schedule_phases s where s.project_id=p.id);
