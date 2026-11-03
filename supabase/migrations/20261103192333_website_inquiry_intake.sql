-- Website intake remains in the existing Todos workflow. No email or financial writes.
alter table public.todos
  add column if not exists website_inquiry jsonb,
  add column if not exists website_request_hash text,
  add column if not exists intake_status text,
  add column if not exists lead_id uuid references public.leads(id) on delete set null;
alter table public.todos add constraint todos_intake_status_check
  check (intake_status is null or intake_status in ('new','contacted','walkthrough','qualified','closed','spam'));
create index if not exists todos_website_queue_idx on public.todos(status, due_date) where source='website';
create index if not exists todos_website_rate_idx on public.todos(website_request_hash, created_at) where source='website';
create index if not exists todos_website_email_idx on public.todos(lower(website_inquiry->>'email'), created_at) where source='website';

-- Preserve the current source list while adding only the two inquiry notification types.
do $$ declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.app_notifications'::regclass and conname='app_notifications_source_type_check';
  if position('website_inquiry' in definition)=0 then
    alter table public.app_notifications drop constraint app_notifications_source_type_check;
    execute 'alter table public.app_notifications add constraint app_notifications_source_type_check check ((' ||
      substring(definition from 8 for char_length(definition)-8) ||
      ') or source_type in (''website_inquiry'',''website_inquiry_overdue''))';
  end if;
end $$;

-- Applies only to website data; unrelated team Todos retain their existing policies.
create policy "Office manages website inquiries" on public.todos as restrictive for all to authenticated
using (source is distinct from 'website' or exists (select 1 from public.profiles p where p.id=auth.uid() and p.role::text in ('owner','precon_manager','office_admin')))
with check (source is distinct from 'website' or exists (select 1 from public.profiles p where p.id=auth.uid() and p.role::text in ('owner','precon_manager','office_admin')));

create or replace function public.website_followup_due(p_received_at timestamptz)
returns timestamptz language sql immutable security invoker set search_path=''
as $$
  select ((d + case extract(isodow from d)::integer when 6 then 2 when 7 then 1 else 0 end)::date + time '17:00') at time zone 'America/New_York'
  from (select (p_received_at at time zone 'America/New_York')::date + 1 as d) dates;
$$;
revoke all on function public.website_followup_due(timestamptz) from public,anon,authenticated;
grant execute on function public.website_followup_due(timestamptz) to service_role,authenticated;

create or replace function public.submit_website_inquiry(p_submission_id uuid,p_payload jsonb,p_request_hash text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.todos%rowtype; intake_owner uuid; reference text; inquiry jsonb; amount integer;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_submission_id is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>40000
    or length(coalesce(p_payload->>'name',''))<2 or length(coalesce(p_payload->>'town',''))<2
    or coalesce(p_payload->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    or coalesce(p_payload->>'projectType','') not in ('addition','adu','kitchen','bathroom','whole-home','lower-level','porch-deck','historic','exterior','other')
    or length(coalesce(p_payload->>'description',''))=0 then raise exception 'Invalid inquiry'; end if;
  perform pg_advisory_xact_lock(hashtextextended('website-id:'||p_submission_id::text,0));
  select * into existing from public.todos where id=p_submission_id;
  if found then
    if existing.source is distinct from 'website' or (existing.website_inquiry - 'reference') is distinct from p_payload then
      return jsonb_build_object('ok',false,'code','SUBMISSION_CONFLICT');
    end if;
    return jsonb_build_object('ok',true,'reference',existing.website_inquiry->>'reference');
  end if;
  -- Serialize count + insert so simultaneous requests cannot bypass the persistent limit.
  perform pg_advisory_xact_lock(hashtextextended('website-email:'||lower(p_payload->>'email'),0));
  if coalesce(p_request_hash,'')<>'' then
    perform pg_advisory_xact_lock(hashtextextended('website-ip:'||p_request_hash,0));
    select count(*) into amount from public.todos where source='website' and website_request_hash=p_request_hash and created_at>now()-interval '1 hour';
    if amount>=20 then return jsonb_build_object('ok',false,'code','RATE_LIMIT'); end if;
  end if;
  select count(*) into amount from public.todos where source='website' and lower(website_inquiry->>'email')=lower(p_payload->>'email') and created_at>now()-interval '1 hour';
  if amount>=5 then return jsonb_build_object('ok',false,'code','RATE_LIMIT'); end if;
  select id into intake_owner from public.profiles where lower(email)='spenney@penneyconstructioninc.com' and role::text in ('owner','precon_manager','office_admin');
  if intake_owner is null then raise exception 'Intake owner is unavailable'; end if;
  reference := 'WEB-'||upper(left(replace(p_submission_id::text,'-',''),12));
  inquiry := p_payload||jsonb_build_object('reference',reference);
  insert into public.todos(id,contact_name,contact_type,project_name,description,priority,category,assignee,source,created_by,due_date,website_inquiry,website_request_hash,intake_status)
  values(p_submission_id,p_payload->>'name','client','Website inquiry · '||(p_payload->>'town'),p_payload->>'description','high','follow_up_clients','Shannon','website',intake_owner,public.website_followup_due(now()),inquiry,nullif(p_request_hash,''),'new');
  insert into public.app_notifications(recipient_profile_id,kind,title,body,url,source_type,source_id)
  select id,'help','New website inquiry',left((p_payload->>'name')||' · '||(p_payload->>'town')||' · '||(p_payload->>'projectType'),500),
    '/command-center/inquiries/'||p_submission_id::text,'website_inquiry',p_submission_id
  from public.profiles where lower(email) in ('spenney@penneyconstructioninc.com','jbetancur@penneyconstructioninc.com')
    and role::text in ('owner','precon_manager','office_admin')
  on conflict(recipient_profile_id,source_type,source_id) do nothing;
  return jsonb_build_object('ok',true,'reference',reference);
end $$;
revoke all on function public.submit_website_inquiry(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.submit_website_inquiry(uuid,jsonb,text) to service_role;

create or replace function public.update_website_inquiry(p_todo_id uuid,p_expected_updated_at timestamptz,p_status text,p_assignee text,p_due_date timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old_row public.todos%rowtype; changed_at timestamptz := clock_timestamp(); terminal boolean;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role::text in ('owner','precon_manager','office_admin')) then raise exception 'Office access required' using errcode='42501'; end if;
  if p_status is null or p_status not in ('new','contacted','walkthrough','qualified','closed','spam') then raise exception 'Invalid inquiry status'; end if;
  if not exists(select 1 from public.profiles where split_part(full_name,' ',1)=p_assignee and role::text in ('owner','precon_manager','office_admin')) then raise exception 'Choose an office owner'; end if;
  terminal := p_status in ('qualified','closed','spam');
  if not terminal and p_due_date is null then raise exception 'Set the next follow-up date'; end if;
  select * into old_row from public.todos where id=p_todo_id and source='website' for update;
  if not found then raise exception 'Inquiry not found'; end if;
  if old_row.updated_at is distinct from p_expected_updated_at then raise exception 'This inquiry changed. Refresh before saving.'; end if;
  update public.todos set intake_status=p_status,assignee=p_assignee,due_date=case when terminal then null else p_due_date end,
    status=case when terminal then 'done'::public.follow_up_status when old_row.status::text='snoozed' then old_row.status else 'open'::public.follow_up_status end,
    snooze_until=case when terminal then null else old_row.snooze_until end,
    completed_at=case when terminal then coalesce(old_row.completed_at,changed_at) else null end,updated_at=changed_at where id=p_todo_id;
  insert into public.activity_log(user_id,action,entity_type,entity_id,details)
  values(auth.uid(),'website_inquiry_updated','website_inquiry',p_todo_id,jsonb_build_object('before',jsonb_build_object('status',old_row.intake_status,'assignee',old_row.assignee,'due_date',old_row.due_date),'after',jsonb_build_object('status',p_status,'assignee',p_assignee,'due_date',case when terminal then null else p_due_date end)));
  return jsonb_build_object('id',p_todo_id,'updated_at',changed_at);
end $$;
revoke all on function public.update_website_inquiry(uuid,timestamptz,text,text,timestamptz) from public,anon;
grant execute on function public.update_website_inquiry(uuid,timestamptz,text,text,timestamptz) to authenticated;

create or replace function public.convert_website_inquiry_to_lead(p_todo_id uuid,p_existing_lead_id uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare inquiry public.todos%rowtype; result_id uuid; client_id uuid; email_value text; full_name_value text; mapped_type text;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role::text in ('owner','precon_manager','office_admin')) then raise exception 'Office access required' using errcode='42501'; end if;
  select * into inquiry from public.todos where id=p_todo_id and source='website' for update;
  if not found then raise exception 'Inquiry not found'; end if;
  if inquiry.lead_id is not null then return inquiry.lead_id; end if;
  if inquiry.intake_status in ('spam','closed') then raise exception 'Reopen the inquiry before creating a lead'; end if;
  email_value := lower(trim(inquiry.website_inquiry->>'email'));
  if coalesce(email_value,'')='' then raise exception 'Inquiry email is missing'; end if;
  perform pg_advisory_xact_lock(hashtextextended('website-lead:'||email_value,0));
  if p_existing_lead_id is not null then
    select id into result_id from public.leads where id=p_existing_lead_id and lower(trim(email))=email_value;
    if result_id is null then raise exception 'The selected lead does not match this inquiry email'; end if;
  else
    -- Email identifies a person, not a project. Reuse only an exact duplicate inquiry.
    select id into result_id from public.leads where lower(trim(email))=email_value and description=inquiry.description order by created_at desc limit 1;
  end if;
  if result_id is null then
    select id into client_id from public.customers where lower(trim(email))=email_value order by created_at desc limit 1;
    full_name_value := trim(inquiry.contact_name);
    mapped_type := case inquiry.website_inquiry->>'projectType' when 'adu' then 'new_construction' when 'whole-home' then 'remodel' when 'historic' then 'remodel' when 'addition' then 'addition' when 'kitchen' then 'kitchen' when 'bathroom' then 'bathroom' else 'other' end;
    insert into public.leads(first_name,last_name,email,phone,city,state,address,project_type,description,referral_source,referral_detail,urgency,timeline_notes,created_by,customer_id)
    values(split_part(full_name_value,' ',1),trim(substr(full_name_value,length(split_part(full_name_value,' ',1))+1)),email_value,nullif(inquiry.website_inquiry->>'phone',''),inquiry.website_inquiry->>'town','MA',
      nullif(inquiry.website_inquiry#>>'{propertyContext,property,address}',''),mapped_type,inquiry.description,'website',inquiry.website_inquiry->>'heardAbout',
      case when inquiry.website_inquiry->>'timeline'='asap' then 'asap' else 'unknown' end,inquiry.website_inquiry->>'timeline',auth.uid(),client_id) returning id into result_id;
  end if;
  update public.todos set lead_id=result_id,intake_status='qualified',status='done',completed_at=now(),due_date=null,snooze_until=null,updated_at=clock_timestamp() where id=p_todo_id;
  insert into public.activity_log(user_id,action,entity_type,entity_id,details) values(auth.uid(),'website_inquiry_linked','website_inquiry',p_todo_id,jsonb_build_object('lead_id',result_id));
  return result_id;
end $$;
revoke all on function public.convert_website_inquiry_to_lead(uuid,uuid) from public,anon;
grant execute on function public.convert_website_inquiry_to_lead(uuid,uuid) to authenticated;

-- Cron fills a missed/reassigned notification and escalates overdue items without sending email.
-- The notification uniqueness key prevents hourly duplicates. Existing read notifications stay read.
create or replace function public.remind_website_inquiries()
returns integer language plpgsql security invoker set search_path='' as $$
declare inserted_count integer; overdue_count integer;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  insert into public.app_notifications(recipient_profile_id,kind,title,body,url,source_type,source_id)
  select p.id,'help','Website inquiry needs review',left(t.contact_name||' · '||coalesce(t.website_inquiry->>'town','')||' · assigned to '||coalesce(t.assignee,'office'),500),
    '/command-center/inquiries/'||t.id::text,'website_inquiry',t.id
  from public.todos t join public.profiles p on (split_part(p.full_name,' ',1)=t.assignee or lower(p.email)='jbetancur@penneyconstructioninc.com')
  where t.source='website' and t.status::text in ('open','snoozed') and coalesce(t.intake_status,'new') not in ('qualified','closed','spam')
    and (t.snooze_until is null or t.snooze_until<=now()) and p.role::text in ('owner','precon_manager','office_admin')
  on conflict(recipient_profile_id,source_type,source_id) do nothing;
  get diagnostics inserted_count=row_count;
  insert into public.app_notifications(recipient_profile_id,kind,title,body,url,source_type,source_id)
  select p.id,'help','Website inquiry follow-up overdue',left(t.contact_name||' · please check whether a reply or next step is already complete.',500),
    '/command-center/inquiries/'||t.id::text,'website_inquiry_overdue',t.id
  from public.todos t join public.profiles p on (split_part(p.full_name,' ',1)=t.assignee or lower(p.email)='jbetancur@penneyconstructioninc.com')
  where t.source='website' and t.status::text in ('open','snoozed') and coalesce(t.intake_status,'new') not in ('qualified','closed','spam')
    and t.due_date<now() and (t.snooze_until is null or t.snooze_until<=now()) and p.role::text in ('owner','precon_manager','office_admin')
  on conflict(recipient_profile_id,source_type,source_id) do nothing;
  get diagnostics overdue_count=row_count;
  return inserted_count+overdue_count;
end $$;
revoke all on function public.remind_website_inquiries() from public,anon,authenticated;
grant execute on function public.remind_website_inquiries() to service_role;

-- Old website releases remain compatible during rollout/rollback; old Todos controls
-- still work without leaving completion and intake status disagreeing.
create or replace function public.sync_website_inquiry_state()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.source is distinct from 'website' then return new; end if;
  if tg_op='INSERT' then
    if new.website_inquiry is null then
      new.website_inquiry := jsonb_strip_nulls(jsonb_build_object(
        'name',new.contact_name,'email',substring(new.description from 'Email: ([^\n\r]+)'),
        'phone',nullif(substring(new.description from 'Phone: ([^\n\r]+)'),'(not given)'),
        'town',substring(new.project_name from 'Website inquiry · (.*)'),
        'projectType',lower(substring(new.description from 'WEBSITE INQUIRY — ([^ ]+) in')),
        'timeline',substring(new.description from 'Timeline: ([^\n\r]+)'),
        'config',substring(new.description from 'Configurator: ([^\n\r]+)'),
        'page',substring(new.description from 'Sent from: ([^\n\r]+)'),
        'heardAbout',substring(new.description from 'Heard about us: ([^\n\r]+)'),
        'source',jsonb_build_object('referrer',substring(new.description from 'Came from: ([^\n\r]+)'),'landing',substring(new.description from 'First page: ([^\n\r]+)')),
        'reference','WEB-'||upper(left(replace(new.id::text,'-',''),12)), 'legacy',true));
    end if;
    new.intake_status := coalesce(new.intake_status,case when new.status::text='done' then 'closed' else 'new' end);
    if new.status::text<>'done' then new.due_date := coalesce(new.due_date,public.website_followup_due(coalesce(new.created_at,now()))); end if;
    return new;
  end if;
  if new.status is distinct from old.status and new.intake_status is not distinct from old.intake_status then
    if new.status::text='done' then
      new.intake_status := case when new.intake_status in ('qualified','closed','spam') then new.intake_status else 'closed' end;
      new.completed_at := coalesce(new.completed_at,now());
    elsif old.status::text='done' then
      new.intake_status := 'new';
      new.completed_at := null;
      new.due_date := coalesce(new.due_date,public.website_followup_due(now()));
    end if;
  end if;
  if new.updated_at is not distinct from old.updated_at then new.updated_at := clock_timestamp(); end if;
  return new;
end $$;
revoke all on function public.sync_website_inquiry_state() from public,anon,authenticated;
create trigger sync_website_inquiry_state before insert or update on public.todos for each row execute function public.sync_website_inquiry_state();

-- Existing submissions retain their original text, IDs, owner, and completion status.
-- An open record means review required, not proof that no one has replied.
update public.todos set website_inquiry=jsonb_strip_nulls(jsonb_build_object(
  'name',contact_name,'email',substring(description from 'Email: ([^\n\r]+)'),
  'phone',nullif(substring(description from 'Phone: ([^\n\r]+)'),'(not given)'),
  'town',substring(project_name from 'Website inquiry · (.*)'),
  'projectType',lower(substring(description from 'WEBSITE INQUIRY — ([^ ]+) in')),
  'timeline',substring(description from 'Timeline: ([^\n\r]+)'),
  'config',substring(description from 'Configurator: ([^\n\r]+)'),
  'page',substring(description from 'Sent from: ([^\n\r]+)'),
  'heardAbout',substring(description from 'Heard about us: ([^\n\r]+)'),
  'source',jsonb_build_object('referrer',substring(description from 'Came from: ([^\n\r]+)'),'landing',substring(description from 'First page: ([^\n\r]+)')),
  'reference','WEB-'||upper(left(replace(id::text,'-',''),12)), 'legacy',true)),
  intake_status=case when status::text='done' then 'closed' else 'new' end,
  due_date=case when status::text='done' then due_date else coalesce(due_date,public.website_followup_due(coalesce(created_at,now()))) end
where source='website' and website_inquiry is null;
