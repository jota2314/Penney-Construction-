create or replace function public.switch_crew_clock_task(p_log_id uuid, p_project_id uuid, p_line_id uuid, p_description text default null)
returns uuid language plpgsql set search_path = '' as $$
declare
 old_log public.daily_logs%rowtype; task public.estimate_line_items%rowtype;
 phase_id uuid; new_log_id uuid; employee_id uuid; boundary timestamptz; today date; active_estimate_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in to switch tasks'; end if;
 -- Serialize switches by worker. A repeated request cannot split twice.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':clock-task',0));
 select * into old_log from public.daily_logs where id=p_log_id and author_id=auth.uid() for update;
 if not found or old_log.status <> 'in_progress' or old_log.ended_at is not null then
   raise exception 'This shift is no longer open. Refresh your time log.';
 end if;
 if old_log.started_at < now() - interval '12 hours' then raise exception 'Close this overdue shift before starting another task.'; end if;
 select p.contract_estimate_id into active_estimate_id from public.projects p where p.id=p_project_id;
 if not found then raise exception 'Project unavailable'; end if;
 if active_estimate_id is null then
   select e.id into active_estimate_id from public.estimates e where e.project_id=p_project_id order by e.version desc limit 1;
 end if;
 if p_line_id is not null then
   select * into task from public.estimate_line_items where id=p_line_id and estimate_line_items.estimate_id=active_estimate_id;
   if not found or task.is_locked or task.is_section_header or not public.crew_field_task(task.description) then raise exception 'Choose an open field task on this job'; end if;
   if old_log.project_id=p_project_id and old_log.estimate_line_item_id=p_line_id then return old_log.id; end if;
 elsif length(btrim(coalesce(p_description,''))) not between 5 and 500 then
   raise exception 'Describe your task in 5–500 characters';
 end if;
 boundary := clock_timestamp(); today := (boundary at time zone 'America/New_York')::date;
 select id into employee_id from public.employees where profile_id=auth.uid() limit 1;
 insert into public.schedule_phases(project_id,name,description,start_date,end_date,status,phase_scope,created_by,assigned_employee_ids,estimate_line_item_id,is_confirmed)
 values(p_project_id,coalesce(left(task.description,120),'Needs allocation'),p_description,today,today,'in_progress','daily',auth.uid(),
 case when employee_id is null then array[]::uuid[] else array[employee_id] end,p_line_id,false) returning id into phase_id;
 update public.daily_logs set ended_at=boundary,status='completed' where id=old_log.id;
 insert into public.daily_logs(schedule_phase_id,project_id,author_id,started_at,status,kind,report_required,estimate_line_item_id,line_item_source,line_item_needs_review,line_item_note)
 values(phase_id,p_project_id,auth.uid(),boundary,'in_progress','shift',true,p_line_id,'manual',p_line_id is null,
 case when p_line_id is null then 'Needs allocation: ' || btrim(p_description) else null end) returning id into new_log_id;
 return new_log_id;
end;
$$;
