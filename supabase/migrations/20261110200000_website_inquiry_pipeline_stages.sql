-- Jorge 2026-11-10: website inquiries move through the pipeline on their own.
--   Team emails the homeowner      -> Contacted
--   Homeowner answers              -> Lead
--   Jorge's project is estimating  -> Estimating
--   Project proposal sent          -> Proposal sent
--   Project contracted or later    -> Won
-- Stages only move forward. Closed and spam are never touched, and a
-- walkthrough is still booked only through Confirm and send invitation.
-- Nothing here creates a project or a lead: Estimating comes from the
-- project Jorge creates (matched by the client's email) when he starts pricing.

alter table public.todos drop constraint todos_intake_status_check;
alter table public.todos add constraint todos_intake_status_check check (intake_status is null or intake_status in
  ('new','contacted','lead','walkthrough','qualified','estimating','proposal_sent','won','closed','spam'));

-- Every automatic move is recorded.
create table public.website_inquiry_stage_events (
  id bigint generated always as identity primary key,
  inquiry_id uuid not null references public.todos(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text not null,
  project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now()
);
create index website_inquiry_stage_events_inquiry_idx on public.website_inquiry_stage_events(inquiry_id, created_at desc);
alter table public.website_inquiry_stage_events enable row level security;
revoke all on table public.website_inquiry_stage_events from public, anon, authenticated;
grant select on table public.website_inquiry_stage_events to authenticated;
grant all on table public.website_inquiry_stage_events to service_role;
create policy "Named team reads inquiry stage history" on public.website_inquiry_stage_events
for select to authenticated using ((select public.can_access_website_inquiries()));

-- True when the exact address appears in an email header ("Name <a@b.com>", lists).
create or replace function public.website_email_in_header(p_header text, p_email text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_header,'') <> '' and coalesce(p_email,'') <> ''
    and strpos(lower(p_header), lower(p_email)) > 0
    and lower(p_header) ~ ('(^|[[:space:]<,;"''])' || regexp_replace(lower(p_email), '([.+*?^$(){}|\[\]\\])', '\\\1', 'g') || '($|[[:space:]>,;"''])')
$$;
revoke all on function public.website_email_in_header(text, text) from public, anon, authenticated;
grant execute on function public.website_email_in_header(text, text) to service_role;

create or replace function public.advance_website_inquiries()
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  r record;
  rank_of constant jsonb := '{"new":0,"contacted":1,"lead":2,"walkthrough":3,"qualified":4,"estimating":5,"proposal_sent":6,"won":7}';
  target text; reason text; project_stage text; handed_off boolean; moved integer := 0;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  for r in
    with active as (
      select t.id, t.created_at, coalesce(t.intake_status,'new') stage, t.project_id, t.lead_id,
             lower(trim(t.website_inquiry->>'email')) email
        from public.todos t
       where t.source = 'website' and coalesce(t.intake_status,'new') not in ('won','closed','spam')
         and t.created_at > now() - interval '180 days'
         and coalesce(trim(t.website_inquiry->>'email'),'') <> ''
    ), linked as (
      select a.*,
        exists (select 1 from public.inbox_emails ie where ie.date > a.created_at
                 and public.website_email_in_header(ie.from_email, a.email)) client_answered,
        exists (select 1 from public.inbox_emails ie where ie.date > a.created_at
                 and ie.from_email ilike '%@penneyconstructioninc.com%'
                 and public.website_email_in_header(ie.to_email, a.email))
          or exists (select 1 from public.website_inquiry_emails e where e.inquiry_id = a.id and e.status = 'sent') team_emailed,
        coalesce(
          a.project_id,
          (select p.id from public.leads l join public.projects p on p.id = l.project_id
            where l.id = a.lead_id and p.status::text <> 'cancelled'),
          (select p.id from public.customers c join public.projects p on p.customer_id = c.id
            where lower(trim(c.email)) = a.email and p.created_at >= a.created_at - interval '30 days'
              and p.status::text <> 'cancelled'
            order by p.created_at desc limit 1)) found_project
      from active a
    )
    select l.*, p.status::text project_status, p.project_number
      from linked l left join public.projects p on p.id = l.found_project
  loop
    target := r.stage; reason := null;
    if r.team_emailed and (rank_of->>target)::int < 1 then target := 'contacted'; reason := 'Team emailed the homeowner'; end if;
    if r.client_answered and (rank_of->>target)::int < 2 then target := 'lead'; reason := 'Homeowner answered'; end if;
    project_stage := case
      when r.project_status = 'lead' then 'lead'
      when r.project_status in ('estimating','waiting_for_approval') then 'estimating'
      when r.project_status = 'proposal_sent' then 'proposal_sent'
      when r.project_status in ('contracted','in_progress','audit','completed') then 'won'
      when r.project_status = 'cancelled' then 'closed' end;
    if project_stage = 'closed' then
      -- Only a project this inquiry was already linked to can close it.
      if r.project_id is not null then target := 'closed'; reason := 'Project '||r.project_number||' was cancelled'; end if;
    elsif project_stage is not null and (rank_of->>project_stage)::int > (rank_of->>target)::int then
      target := project_stage; reason := 'Project '||r.project_number||' is '||replace(r.project_status,'_',' ');
    end if;
    if target is not distinct from r.stage and (r.found_project is null or r.project_id is not null) then continue; end if;
    handed_off := target in ('qualified','estimating','proposal_sent','won','closed','spam');
    update public.todos t
       set intake_status = target,
           project_id = coalesce(t.project_id, r.found_project),
           status = case when handed_off then 'done'::public.follow_up_status else t.status end,
           due_date = case when handed_off then null else t.due_date end,
           snooze_until = case when handed_off then null else t.snooze_until end,
           completed_at = case when handed_off then coalesce(t.completed_at, now()) else t.completed_at end,
           updated_at = clock_timestamp()
     where t.id = r.id and coalesce(t.intake_status,'new') = r.stage;
    if found and target is distinct from r.stage then
      insert into public.website_inquiry_stage_events(inquiry_id, from_status, to_status, reason, project_id)
      values (r.id, r.stage, target, reason, r.found_project);
      moved := moved + 1;
    end if;
  end loop;
  return moved;
end $$;
revoke all on function public.advance_website_inquiries() from public, anon, authenticated;
grant execute on function public.advance_website_inquiries() to service_role;

-- Marking the Todo done keeps a later pipeline stage instead of closing it.
create or replace function public.sync_website_inquiry_state()
returns trigger language plpgsql set search_path = '' as $function$
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
      new.intake_status := case when new.intake_status in ('qualified','estimating','proposal_sent','won','closed','spam') then new.intake_status else 'closed' end;
      new.completed_at := coalesce(new.completed_at,now());
    elsif old.status::text='done' then
      new.intake_status := 'new';
      new.completed_at := null;
      new.due_date := coalesce(new.due_date,public.website_followup_due(now()));
    end if;
  end if;
  if new.updated_at is not distinct from old.updated_at then new.updated_at := clock_timestamp(); end if;
  return new;
end $function$;

-- The office can also pick the new stages by hand.
create or replace function public.update_website_inquiry(p_todo_id uuid,p_expected_updated_at timestamptz,p_status text,p_assignee text,p_due_date timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old_row public.todos%rowtype; changed_at timestamptz := clock_timestamp(); terminal boolean;
begin
  if not public.can_access_website_inquiries() then raise exception 'Website inquiry access required' using errcode='42501'; end if;
  if p_status is null or p_status not in ('new','contacted','lead','walkthrough','qualified','estimating','proposal_sent','won','closed','spam') then raise exception 'Invalid inquiry status'; end if;
  -- Canonical names match the protected membership rows, not editable profiles.
  if p_assignee is null or p_assignee not in ('Jorge','Ryan','Nicole','Shannon') then raise exception 'Choose Jorge, Ryan, Nicole or Shannon'; end if;
  terminal := p_status in ('qualified','estimating','proposal_sent','won','closed','spam');
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

-- Linking a lead never moves an inquiry back from a later stage.
create or replace function public.convert_website_inquiry_to_lead(p_todo_id uuid,p_existing_lead_id uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare inquiry public.todos%rowtype; result_id uuid; client_id uuid; email_value text; full_name_value text; mapped_type text;
begin
  if not public.can_access_website_inquiries() then raise exception 'Website inquiry access required' using errcode='42501'; end if;
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
  update public.todos set lead_id=result_id,
    intake_status=case when inquiry.intake_status in ('estimating','proposal_sent','won') then inquiry.intake_status else 'qualified' end,
    status='done',completed_at=coalesce(completed_at,now()),due_date=null,snooze_until=null,updated_at=clock_timestamp() where id=p_todo_id;
  insert into public.activity_log(user_id,action,entity_type,entity_id,details) values(auth.uid(),'website_inquiry_linked','website_inquiry',p_todo_id,jsonb_build_object('lead_id',result_id));
  return result_id;
end $$;
