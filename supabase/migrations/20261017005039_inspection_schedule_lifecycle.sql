-- Inspection results and their exact master milestone share one transaction.
-- No historical name matching, project completion, billing or notifications.
create table if not exists public.project_inspections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null, sort_order integer not null default 0,
  status text not null default 'pending' check (status in ('pending','passed','failed')),
  completed_at timestamptz, is_final boolean not null default false,
  review_sent_at timestamptz, notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.project_inspections
  add column if not exists schedule_phase_id uuid references public.schedule_phases(id) on delete set null,
  add column if not exists scheduled_for date;
alter table public.schedule_phases add column if not exists actual_completed_at timestamptz;
create unique index if not exists project_inspections_schedule_phase_unique
  on public.project_inspections(schedule_phase_id) where schedule_phase_id is not null;
create index if not exists project_inspections_project_schedule_idx on public.project_inspections(project_id,sort_order);

create or replace function public.can_manage_inspection_schedule() returns boolean
language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles where id=auth.uid()
      and role::text in ('owner','precon_manager','office_admin','project_manager')
  )
$$;
revoke all on function public.can_manage_inspection_schedule() from public,anon;
grant execute on function public.can_manage_inspection_schedule() to authenticated,service_role;

alter table public.project_inspections enable row level security;
grant select,insert,update,delete on public.project_inspections to authenticated,service_role;
-- Restrictive policy also closes the older authenticated-true policies.
create policy inspection_schedule_office_guard on public.project_inspections
  as restrictive for all to authenticated
  using ((select public.can_manage_inspection_schedule()))
  with check ((select public.can_manage_inspection_schedule()));
create policy inspection_schedule_office_access on public.project_inspections
  for all to authenticated using ((select public.can_manage_inspection_schedule()))
  with check ((select public.can_manage_inspection_schedule()));

create table public.inspection_schedule_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  inspection_id uuid not null, schedule_phase_id uuid,
  actor_id uuid, actor_subcontractor_id uuid,
  source text not null, before_record jsonb, after_record jsonb,
  created_at timestamptz not null default now()
);
alter table public.inspection_schedule_history enable row level security;
grant select,insert on public.inspection_schedule_history to authenticated,service_role;
create policy inspection_history_read on public.inspection_schedule_history for select to authenticated
  using ((select public.can_manage_inspection_schedule()));
create policy inspection_history_append on public.inspection_schedule_history for insert to authenticated
  with check ((select public.can_manage_inspection_schedule()) and actor_id=auth.uid() and pg_trigger_depth()>0);

create or replace function public.guard_project_inspection_schedule() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare phase public.schedule_phases%rowtype;
begin
  if current_user not in ('service_role','postgres','supabase_admin') and not public.can_manage_inspection_schedule() then
    raise exception 'Office schedule access required';
  end if;
  if new.schedule_phase_id is not null then
    select * into phase from public.schedule_phases where id=new.schedule_phase_id for update;
    if not found or phase.project_id is distinct from new.project_id or phase.phase_scope <> 'master' then
      raise exception 'Choose a master milestone from this project';
    end if;
    if phase.event_type is distinct from 'inspection' then
      raise exception 'Choose an inspection milestone';
    end if;
  end if;
  if new.status='pending' then new.completed_at:=null; end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;

create or replace function public.sync_project_inspection_schedule() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare before_json jsonb; phase public.schedule_phases%rowtype; booking_changed boolean;
begin
  if tg_op='UPDATE' then before_json:=to_jsonb(old); end if;
  if tg_op='INSERT' or (before_json-'updated_at') is distinct from (to_jsonb(new)-'updated_at') then
    insert into public.inspection_schedule_history(project_id,inspection_id,schedule_phase_id,actor_id,actor_subcontractor_id,source,before_record,after_record)
    values(new.project_id,new.id,new.schedule_phase_id,auth.uid(),
      nullif(current_setting('penney.inspection_sub_id',true),'')::uuid,
      coalesce(nullif(current_setting('penney.inspection_source',true),''),case when pg_trigger_depth()>1 then 'schedule' else 'inspection' end),before_json,to_jsonb(new));
  end if;
  if pg_trigger_depth()>1 or new.schedule_phase_id is null then return new; end if;
  select * into phase from public.schedule_phases where id=new.schedule_phase_id for update;
  if not found then return new; end if;
  booking_changed:=case when tg_op='INSERT' then new.scheduled_for is not null else
    new.scheduled_for is distinct from old.scheduled_for or
    (new.schedule_phase_id is distinct from old.schedule_phase_id and new.scheduled_for is not null) end;
  update public.schedule_phases set
    status=case new.status when 'passed' then 'completed'::public.schedule_phase_status
      when 'failed' then 'on_hold'::public.schedule_phase_status
      else case when phase.status in ('completed','on_hold') then 'not_started'::public.schedule_phase_status else phase.status end end,
    actual_completed_at=case when new.status='passed' then new.completed_at else null end,
    start_date=case when booking_changed and new.scheduled_for is not null then new.scheduled_for else start_date end,
    end_date=case when booking_changed and new.scheduled_for is not null then new.scheduled_for else end_date end,
    is_manually_scheduled=case when booking_changed then new.scheduled_for is not null else is_manually_scheduled end,
    is_confirmed=case when booking_changed and new.scheduled_for is null then false else is_confirmed end,
    updated_at=clock_timestamp()
  where id=new.schedule_phase_id;
  return new;
end $$;

create or replace function public.guard_inspection_phase_lifecycle() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare linked boolean;
begin
  select exists(select 1 from public.project_inspections where schedule_phase_id=new.id) into linked;
  if not linked and not (new.phase_scope='master' and new.event_type='inspection')
    and not (tg_op='UPDATE' and old.phase_scope='master' and old.event_type='inspection') then return new; end if;
  if current_user not in ('service_role','postgres','supabase_admin') and not public.can_manage_inspection_schedule() then
    raise exception 'Office schedule access required for inspection milestones';
  end if;
  if linked and (new.phase_scope<>'master' or new.event_type is distinct from 'inspection' or
      exists(select 1 from public.project_inspections where schedule_phase_id=new.id and project_id is distinct from new.project_id)) then
    raise exception 'Unlink the inspection before changing its project or milestone type';
  end if;
  -- Inspection-origin writes carry their known historical actual timestamp.
  if pg_trigger_depth()=1 then
    if new.status='completed' and (tg_op='INSERT' or old.status is distinct from new.status) then
      new.actual_completed_at:=coalesce(new.actual_completed_at,clock_timestamp());
    elsif new.status<>'completed' then new.actual_completed_at:=null; end if;
  end if;
  return new;
end $$;

create or replace function public.sync_inspection_phase_lifecycle() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare inspection public.project_inspections%rowtype; next_status text; next_date date;
begin
  if pg_trigger_depth()>1 then return new; end if;
  select * into inspection from public.project_inspections where schedule_phase_id=new.id for update;
  if not found then
    if tg_op='INSERT' and new.phase_scope='master' and new.event_type='inspection'
       and coalesce(current_setting('penney.inspection_create_existing',true),'') <> 'true' then
      insert into public.project_inspections(project_id,name,sort_order,status,completed_at,schedule_phase_id,scheduled_for,created_by)
      values(new.project_id,new.name,new.sort_order,case when new.status='completed' then 'passed' else 'pending' end,
        new.actual_completed_at,new.id,case when new.is_confirmed or new.is_manually_scheduled then new.start_date else null end,new.created_by);
    end if;
    return new;
  end if;
  next_status:=inspection.status;
  if new.status='completed' then next_status:='passed';
  elsif new.status in ('not_started','in_progress') or inspection.status='passed' then next_status:='pending';
  end if; -- A generic hold is not evidence of a failed inspection.
  next_date:=inspection.scheduled_for;
  if new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date then next_date:=new.start_date; end if;
  if (next_status,next_date,case when next_status='passed' then new.actual_completed_at when next_status='failed' then inspection.completed_at else null end)
      is distinct from (inspection.status,inspection.scheduled_for,inspection.completed_at) then
    update public.project_inspections set status=next_status,scheduled_for=next_date,
      completed_at=case when next_status='passed' then new.actual_completed_at when next_status='failed' then inspection.completed_at else null end
    where id=inspection.id;
  end if;
  return new;
end $$;

create trigger guard_project_inspection_schedule before insert or update on public.project_inspections
  for each row execute function public.guard_project_inspection_schedule();
create trigger sync_project_inspection_schedule after insert or update on public.project_inspections
  for each row execute function public.sync_project_inspection_schedule();
create trigger guard_inspection_phase_lifecycle before insert or update on public.schedule_phases
  for each row execute function public.guard_inspection_phase_lifecycle();
create trigger sync_inspection_phase_lifecycle after insert or update on public.schedule_phases
  for each row execute function public.sync_inspection_phase_lifecycle();

create or replace function public.update_project_inspection_lifecycle(
  p_inspection_id uuid,p_patch jsonb,p_expected_updated_at timestamptz,
  p_source text default 'office',p_subcontractor_id uuid default null
) returns public.project_inspections
language plpgsql security invoker set search_path = '' as $$
declare row_before public.project_inspections%rowtype; result public.project_inspections%rowtype;
begin
  if current_user not in ('service_role','postgres','supabase_admin') and not public.can_manage_inspection_schedule() then raise exception 'Office schedule access required'; end if;
  if p_subcontractor_id is not null and current_user not in ('service_role','postgres','supabase_admin') then raise exception 'Subcontractor identity requires the portal service'; end if;
  if exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('status','scheduled_for','completed_at','notes','name','is_final')) then raise exception 'Unsupported inspection change'; end if;
  select * into row_before from public.project_inspections where id=p_inspection_id for update;
  if not found then raise exception 'Inspection not found or access denied'; end if;
  if p_expected_updated_at is null or row_before.updated_at is distinct from p_expected_updated_at then raise exception 'Inspection changed. Refresh and review it again.'; end if;
  perform set_config('penney.inspection_source',left(p_source,80),true);
  perform set_config('penney.inspection_sub_id',coalesce(p_subcontractor_id::text,''),true);
  update public.project_inspections set
    status=case when p_patch?'status' then p_patch->>'status' else status end,
    scheduled_for=case when p_patch?'scheduled_for' then (p_patch->>'scheduled_for')::date else scheduled_for end,
    completed_at=case when p_patch?'completed_at' then (p_patch->>'completed_at')::timestamptz
      when p_patch->>'status' in ('passed','failed') and p_patch->>'status' is distinct from status then clock_timestamp() else completed_at end,
    notes=case when p_patch?'notes' then nullif(p_patch->>'notes','') else notes end,
    name=case when p_patch?'name' then nullif(trim(p_patch->>'name'),'') else name end,
    is_final=case when p_patch?'is_final' then (p_patch->>'is_final')::boolean else is_final end
  where id=p_inspection_id returning * into result;
  perform set_config('penney.inspection_source','',true);
  perform set_config('penney.inspection_sub_id','',true);
  return result;
end $$;

create or replace function public.link_project_inspection_schedule(
  p_inspection_id uuid,p_phase_id uuid,p_authority text,p_expected_updated_at timestamptz
) returns public.project_inspections
language plpgsql security invoker set search_path = '' as $$
declare inspection public.project_inspections%rowtype; phase public.schedule_phases%rowtype; result public.project_inspections%rowtype;
begin
  if not public.can_manage_inspection_schedule() then raise exception 'Office schedule access required'; end if;
  if p_authority not in ('inspection','schedule') then raise exception 'Choose which verified record to keep'; end if;
  select * into inspection from public.project_inspections where id=p_inspection_id for update;
  if not found then raise exception 'Inspection not found or access denied'; end if;
  if p_expected_updated_at is null or inspection.updated_at is distinct from p_expected_updated_at then raise exception 'Inspection changed. Refresh and review it again.'; end if;
  if p_phase_id is not null then
    select * into phase from public.schedule_phases where id=p_phase_id for update;
    if not found or phase.project_id is distinct from inspection.project_id or phase.phase_scope<>'master' or phase.event_type is distinct from 'inspection' then raise exception 'Choose an inspection milestone from this project'; end if;
    if exists(select 1 from public.project_inspections where schedule_phase_id=p_phase_id and id<>p_inspection_id) then raise exception 'That milestone is already linked to another inspection'; end if;
  end if;
  perform set_config('penney.inspection_source','link:'||p_authority,true);
  update public.project_inspections set schedule_phase_id=p_phase_id,
    status=case when p_phase_id is not null and p_authority='schedule' then case when phase.status='completed' then 'passed' else 'pending' end else status end,
    completed_at=case when p_phase_id is not null and p_authority='schedule' then phase.actual_completed_at else completed_at end,
    scheduled_for=case when p_phase_id is not null and p_authority='schedule' then case when phase.is_confirmed or phase.is_manually_scheduled then phase.start_date else null end else scheduled_for end
  where id=p_inspection_id returning * into result;
  perform set_config('penney.inspection_source','',true);
  return result;
end $$;

create or replace function public.create_project_inspection_phase(p_inspection_id uuid,p_date date,p_expected_updated_at timestamptz)
returns public.project_inspections language plpgsql security invoker set search_path = '' as $$
declare inspection public.project_inspections%rowtype; phase_id uuid; result public.project_inspections%rowtype;
begin
  if not public.can_manage_inspection_schedule() then raise exception 'Office schedule access required'; end if;
  select * into inspection from public.project_inspections where id=p_inspection_id for update;
  if not found then raise exception 'Inspection not found or access denied'; end if;
  if p_expected_updated_at is null or inspection.updated_at is distinct from p_expected_updated_at then raise exception 'Inspection changed. Refresh and review it again.'; end if;
  if inspection.schedule_phase_id is not null then raise exception 'Inspection already has a milestone'; end if;
  if p_date is null then raise exception 'Choose the milestone date'; end if;
  perform set_config('penney.inspection_create_existing','true',true);
  insert into public.schedule_phases(project_id,name,start_date,end_date,planned_start_date,planned_end_date,status,phase_scope,event_type,sort_order,is_manually_scheduled,created_by)
  values(inspection.project_id,inspection.name,p_date,p_date,p_date,p_date,'not_started','master','inspection',inspection.sort_order,true,auth.uid()) returning id into phase_id;
  perform set_config('penney.inspection_create_existing','',true);
  perform set_config('penney.inspection_source','create-milestone',true);
  update public.project_inspections set schedule_phase_id=phase_id,scheduled_for=p_date where id=p_inspection_id returning * into result;
  perform set_config('penney.inspection_source','',true);
  return result;
end $$;

revoke all on function public.update_project_inspection_lifecycle(uuid,jsonb,timestamptz,text,uuid) from public,anon;
revoke all on function public.link_project_inspection_schedule(uuid,uuid,text,timestamptz) from public,anon;
revoke all on function public.create_project_inspection_phase(uuid,date,timestamptz) from public,anon;
grant execute on function public.update_project_inspection_lifecycle(uuid,jsonb,timestamptz,text,uuid) to authenticated,service_role;
grant execute on function public.link_project_inspection_schedule(uuid,uuid,text,timestamptz) to authenticated;
grant execute on function public.create_project_inspection_phase(uuid,date,timestamptz) to authenticated;
-- Trigger functions are not callable as public RPCs.
revoke all on function public.guard_project_inspection_schedule(),public.sync_project_inspection_schedule(),public.guard_inspection_phase_lifecycle(),public.sync_inspection_phase_lifecycle() from public,anon,authenticated;
