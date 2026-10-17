-- Reconciliation must verify both records the office compared. Preserve the
-- schedule exactly when it is authoritative, including a generic hold.
create or replace function public.sync_project_inspection_schedule() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare before_json jsonb; phase public.schedule_phases%rowtype; booking_changed boolean; result_changed boolean;
begin
  if tg_op='UPDATE' then before_json:=to_jsonb(old); end if;
  if tg_op='INSERT' or (before_json-'updated_at') is distinct from (to_jsonb(new)-'updated_at') then
    insert into public.inspection_schedule_history(project_id,inspection_id,schedule_phase_id,actor_id,actor_subcontractor_id,source,before_record,after_record)
    values(new.project_id,new.id,new.schedule_phase_id,auth.uid(),
      nullif(current_setting('penney.inspection_sub_id',true),'')::uuid,
      coalesce(nullif(current_setting('penney.inspection_source',true),''),case when pg_trigger_depth()>1 then 'schedule' else 'inspection' end),before_json,to_jsonb(new));
  end if;
  if pg_trigger_depth()>1 or new.schedule_phase_id is null or coalesce(current_setting('penney.inspection_link_schedule',true),'')='true' then return new; end if;
  select * into phase from public.schedule_phases where id=new.schedule_phase_id for update;
  if not found then return new; end if;
  booking_changed:=case when tg_op='INSERT' then new.scheduled_for is not null else
    new.scheduled_for is distinct from old.scheduled_for or
    (new.schedule_phase_id is distinct from old.schedule_phase_id and new.scheduled_for is not null) end;
  result_changed:=case when tg_op='INSERT' then true else
    new.status is distinct from old.status or new.schedule_phase_id is distinct from old.schedule_phase_id end;
  update public.schedule_phases set
    status=case new.status when 'passed' then 'completed'::public.schedule_phase_status
      when 'failed' then 'on_hold'::public.schedule_phase_status
      else case when result_changed and phase.status in ('completed','on_hold') then 'not_started'::public.schedule_phase_status else phase.status end end,
    actual_completed_at=case when new.status='passed' then new.completed_at else null end,
    start_date=case when booking_changed and new.scheduled_for is not null then new.scheduled_for else start_date end,
    end_date=case when booking_changed and new.scheduled_for is not null then new.scheduled_for else end_date end,
    is_manually_scheduled=case when booking_changed then new.scheduled_for is not null else is_manually_scheduled end,
    is_confirmed=case when booking_changed and new.scheduled_for is null then false else is_confirmed end,
    updated_at=clock_timestamp()
  where id=new.schedule_phase_id;
  return new;
end $$;

drop function public.link_project_inspection_schedule(uuid,uuid,text,timestamptz);
create function public.link_project_inspection_schedule(
  p_inspection_id uuid,p_phase_id uuid,p_authority text,p_expected_updated_at timestamptz,
  p_phase_expected_updated_at timestamptz default null
) returns public.project_inspections
language plpgsql security invoker set search_path = '' as $$
declare inspection public.project_inspections%rowtype; phase public.schedule_phases%rowtype; result public.project_inspections%rowtype;
begin
  if not public.can_manage_inspection_schedule() then raise exception 'Office schedule access required'; end if;
  if p_authority is null or p_authority not in ('inspection','schedule') then raise exception 'Choose which verified record to keep'; end if;
  select * into inspection from public.project_inspections where id=p_inspection_id for update;
  if not found then raise exception 'Inspection not found or access denied'; end if;
  if p_expected_updated_at is null or inspection.updated_at is distinct from p_expected_updated_at then raise exception 'Inspection changed. Refresh and review it again.'; end if;
  if p_phase_id is not null then
    select * into phase from public.schedule_phases where id=p_phase_id for update;
    if not found or phase.project_id is distinct from inspection.project_id or coalesce(phase.phase_scope,'master')<>'master' or phase.event_type is distinct from 'inspection' then raise exception 'Choose an inspection milestone from this project'; end if;
    if p_phase_expected_updated_at is null or phase.updated_at is distinct from p_phase_expected_updated_at then raise exception 'Milestone changed. Refresh and compare both records again.'; end if;
    if exists(select 1 from public.project_inspections where schedule_phase_id=p_phase_id and id<>p_inspection_id) then raise exception 'That milestone is already linked to another inspection'; end if;
  end if;
  perform set_config('penney.inspection_source','link:'||p_authority,true);
  perform set_config('penney.inspection_link_schedule',case when p_phase_id is not null and p_authority='schedule' then 'true' else '' end,true);
  update public.project_inspections set schedule_phase_id=p_phase_id,
    status=case when p_phase_id is not null and p_authority='schedule' then case when phase.status='completed' then 'passed' else 'pending' end else status end,
    completed_at=case when p_phase_id is not null and p_authority='schedule' then phase.actual_completed_at else completed_at end,
    scheduled_for=case when p_phase_id is not null and p_authority='schedule' then case when phase.is_confirmed or phase.is_manually_scheduled then phase.start_date else null end else scheduled_for end
  where id=p_inspection_id returning * into result;
  perform set_config('penney.inspection_source','',true);
  perform set_config('penney.inspection_link_schedule','',true);
  return result;
end $$;
revoke all on function public.link_project_inspection_schedule(uuid,uuid,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.link_project_inspection_schedule(uuid,uuid,text,timestamptz,timestamptz) to authenticated;
