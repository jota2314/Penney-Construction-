-- Atomic task switching, and conservative report/task exception checks.
-- Invoker security retains existing table RLS; no new tables or broad grants.
create or replace function public.crew_field_task(p_text text)
returns boolean language sql immutable set search_path = '' as $$
 select coalesce(btrim(p_text),'') <> ''
 and lower(p_text) !~ '\m(permits?|administration|project management|pm fee|insurance|contingency|profit|sales tax)\M'
 and not (lower(p_text) ~ '\m(materials?|supply only|purchase|allowance)\M' and lower(p_text) !~ '\m(labor|install|installation|framing|repair|owner project)\M')
 and not (lower(p_text) ~ '\mmaterials?\M' and lower(p_text) !~ '\m(labor|install|installation|repair)\M');
$$;
create or replace function public.crew_task_topics(p_text text)
returns text[] language sql immutable set search_path = '' as $$
 select coalesce(array_agg(topic),array[]::text[]) from (values
 ('framing', '\m(framing|framed|frame|ledger|joists?|rafters?|beams?|blocking|headers?)\M'),
 ('wallpaper', '\mwallpaper\M'), ('demolition', '\m(demo|demoed|demolition|tear out|tore out|pulled up|removing flooring)\M'),
 ('trim', '\m(trim|trimmed|trimed|baseboard|casing|crown|soffit|fascia|corner board)\M'),
 ('siding', '\msiding\M'), ('insulation', '\m(insulation|insulate|insulated|fire caulk|fire stop|fireproofing)\M'),
 ('deck', '\m(deck|decks|decking|railings?|sonotubes?|footings?)\M'), ('rot', '\m(rot|rotted|rotten)\M')
 ) as topics(topic, pattern) where lower(coalesce(p_text,'')) ~ pattern;
$$;
create or replace function public.switch_crew_clock_task(p_log_id uuid, p_project_id uuid, p_line_id uuid, p_description text default null)
returns uuid language plpgsql set search_path = '' as $$
declare
 old_log public.daily_logs%rowtype; task public.estimate_line_items%rowtype;
 phase_id uuid; new_log_id uuid; employee_id uuid; boundary timestamptz; today date; estimate_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in to switch tasks'; end if;
 -- Serialize switches by worker. A repeated request cannot split twice.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':clock-task',0));
 select * into old_log from public.daily_logs where id=p_log_id and author_id=auth.uid() for update;
 if not found or old_log.status <> 'in_progress' or old_log.ended_at is not null then
   raise exception 'This shift is no longer open. Refresh your time log.';
 end if;
 if old_log.started_at < now() - interval '12 hours' then raise exception 'Close this overdue shift before starting another task.'; end if;
 select p.contract_estimate_id into estimate_id from public.projects p where p.id=p_project_id;
 if not found then raise exception 'Project unavailable'; end if;
 if estimate_id is null then
   select e.id into estimate_id from public.estimates e where e.project_id=p_project_id order by e.version desc limit 1;
 end if;
 if p_line_id is not null then
   select * into task from public.estimate_line_items where id=p_line_id and estimate_line_items.estimate_id=estimate_id;
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
create or replace function public.review_crew_task_report()
returns trigger language plpgsql set search_path = '' as $$
declare r record; narrative text; line_topics text[]; report_topics text[]; reason text;
begin
 -- Flags only. Never move time or manufacture a split from a narrative.
 for r in select d.*, l.description as task_description, p.description as phase_description,
   l.is_section_header as header, e.project_id as line_project, report.text as report_text
   from public.daily_logs d
   left join public.schedule_phases p on p.id=d.schedule_phase_id
   left join public.estimate_line_items l on l.id=coalesce(d.estimate_line_item_id,p.estimate_line_item_id)
   left join public.estimates e on e.id=l.estimate_id
   left join public.daily_logs report on report.id=d.daily_report_id and report.author_id=d.author_id and report.project_id=d.project_id
   where (d.id=new.id or d.daily_report_id=new.id) and d.subcontractor_id is null
   and (d.status='in_progress' or d.ended_at>d.started_at)
 loop
   reason := null;
   narrative := concat_ws(' ',r.text,r.report_text);
   line_topics := public.crew_task_topics(r.task_description);
   report_topics := public.crew_task_topics(narrative);
   if r.task_description is null then reason := 'Needs allocation: ' || coalesce(nullif(r.phase_description,''),'describe the work and select a task.');
   elsif r.line_project is distinct from r.project_id or r.header then reason := 'Task/project link needs office review.';
   elsif not public.crew_field_task(r.task_description) then reason := 'Office or material-only line selected for crew time.';
   elsif cardinality(report_topics)>0 and not (line_topics && report_topics) then
     reason := 'Work report describes ' || array_to_string(report_topics,', ') || '; selected task is ' || r.task_description || '. Confirm allocation.';
   elsif cardinality(report_topics)>1 and not (report_topics <@ line_topics) then
     reason := 'Work report covers several tasks. Confirm whether hours need a split; selected task is ' || r.task_description || '.';
   end if;
   if reason is not null and position(reason in coalesce(r.line_item_note,''))=0 then
     update public.daily_logs set line_item_needs_review=true,
       line_item_note=concat_ws(E'\n',nullif(line_item_note,''),'Task/report check: ' || reason)
       where id=r.id;
   end if;
 end loop;
 return new;
end;
$$;
create trigger z_review_crew_task_report after insert or update of text, daily_report_id, status, ended_at on public.daily_logs
for each row execute function public.review_crew_task_report();
revoke all on function public.switch_crew_clock_task(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.switch_crew_clock_task(uuid,uuid,uuid,text) to authenticated;
revoke all on function public.review_crew_task_report() from public,anon;
revoke all on function public.crew_field_task(text) from public,anon;
revoke all on function public.crew_task_topics(text) from public,anon;
grant execute on function public.crew_field_task(text),public.crew_task_topics(text) to authenticated,service_role;
