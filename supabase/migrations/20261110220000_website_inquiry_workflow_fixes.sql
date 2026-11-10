-- Jorge 2026-11-10: the website inquiries page is a workflow. A lead must stay
-- in it until someone chooses Closed on the inquiry itself.
--
-- 1. Ticking off the follow-up Todo no longer closes the inquiry. Ryan Brown
--    (walkthrough booked for Mon Nov 16) vanished that way.
-- 2. A Google Calendar invitation emailed from the team to the homeowner counts
--    as Walkthrough booked, the same as the app's Confirm and send invitation.

-- The automatic stage job (service role) may record a walkthrough that was
-- booked from Google Calendar. People still book through the app.
create or replace function public.validate_website_walkthrough_request()
returns trigger language plpgsql set search_path = '' as $function$
declare r jsonb; s timestamptz; e timestamptz;
begin
 if new.source is distinct from 'website' then return new; end if;
 if tg_op='UPDATE' and current_user not in ('service_role','postgres') and
   exists(select 1 from public.website_walkthrough_bookings where inquiry_id=new.id and operation_until>clock_timestamp()) and
   (new.status is distinct from old.status or new.intake_status is distinct from old.intake_status
    or new.assignee is distinct from old.assignee or new.website_inquiry is distinct from old.website_inquiry) then
   raise exception 'A walkthrough confirmation is processing. Wait for its result before changing the inquiry.';
 end if;
 r:=new.website_inquiry->'walkthrough';
 if r is not null and r<>'null'::jsonb then
   if jsonb_typeof(r)<>'object' or r->>'timeZone' is distinct from 'America/New_York'
     or length(btrim(coalesce(r->>'address',''))) not between 5 and 500 then raise exception 'Invalid walkthrough request'; end if;
   s:=(r->>'start')::timestamptz; e:=(r->>'end')::timestamptz;
   if s is null or e is null or e<>s+interval '1 hour' then raise exception 'Invalid walkthrough time'; end if;
   if tg_op='INSERT' and (s<now() or s>now()+interval '60 days') then raise exception 'Choose a future walkthrough within 60 days'; end if;
 end if;
 if tg_op='UPDATE' and current_user not in ('service_role','postgres') and jsonb_typeof(r)='object'
   and new.intake_status='walkthrough' and old.intake_status is distinct from 'walkthrough'
   and not exists(select 1 from public.website_walkthrough_bookings where inquiry_id=new.id and status='confirmed') then
   raise exception 'Use Confirm and send invitation to book a walkthrough';
 end if;
 return new;
end $function$;

-- Ticking off the follow-up keeps the inquiry's stage. Reopening a closed or
-- spam inquiry starts it over as New.
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
      new.completed_at := coalesce(new.completed_at,now());
    elsif old.status::text='done' then
      if new.intake_status in ('closed','spam') then new.intake_status := 'new'; end if;
      new.completed_at := null;
      new.due_date := coalesce(new.due_date,public.website_followup_due(now()));
    end if;
  end if;
  if new.updated_at is not distinct from old.updated_at then new.updated_at := clock_timestamp(); end if;
  return new;
end $function$;

-- Start time from a Google Calendar subject such as
-- "Invitation: Ryan Brown - @ Mon Nov 16, 2026 1pm - 2pm (EST) (Ryan Penney)".
-- Returns null when the subject has no readable time.
create or replace function public.website_invite_start(p_subject text)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare m text[]; hour24 integer;
begin
  m := regexp_match(coalesce(p_subject,''), '@ [A-Za-z]{3} ([A-Za-z]{3} [0-9]{1,2}, [0-9]{4}) ([0-9]{1,2})(:([0-9]{2}))?(am|pm)', 'i');
  if m is null then return null; end if;
  hour24 := (m[2]::integer % 12) + case when lower(m[5]) = 'pm' then 12 else 0 end;
  return (to_date(m[1], 'Mon DD, YYYY') + make_time(hour24, coalesce(m[4], '0')::integer, 0)) at time zone 'America/New_York';
exception when others then return null;
end $$;
revoke all on function public.website_invite_start(text) from public, anon, authenticated;
grant execute on function public.website_invite_start(text) to service_role;

create or replace function public.advance_website_inquiries()
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  r record;
  rank_of constant jsonb := '{"new":0,"contacted":1,"lead":2,"walkthrough":3,"qualified":4,"estimating":5,"proposal_sent":6,"won":7}';
  target text; reason text; project_stage text; handed_off boolean; walk_start timestamptz; moved integer := 0;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  for r in
    with active as (
      select t.id, t.created_at, coalesce(t.intake_status,'new') stage, t.project_id, t.lead_id,
             lower(trim(t.website_inquiry->>'email')) email, t.website_inquiry->'walkthrough'->>'start' requested_start
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
        (select ie.subject from public.inbox_emails ie where ie.date > a.created_at
           and ie.from_email ilike '%@penneyconstructioninc.com%'
           and (ie.subject ilike 'invitation:%' or ie.subject ilike 'updated invitation:%')
           and public.website_email_in_header(ie.to_email, a.email)
         order by ie.date desc limit 1) invite_subject,
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
    target := r.stage; reason := null; walk_start := null;
    if r.team_emailed and (rank_of->>target)::int < 1 then target := 'contacted'; reason := 'Team emailed the homeowner'; end if;
    if r.client_answered and (rank_of->>target)::int < 2 then target := 'lead'; reason := 'Homeowner answered'; end if;
    if r.invite_subject is not null and (rank_of->>target)::int < 3 then
      target := 'walkthrough'; reason := 'Calendar invite sent: '||left(r.invite_subject, 160);
      walk_start := coalesce(public.website_invite_start(r.invite_subject), r.requested_start::timestamptz);
    end if;
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
           -- A booked walkthrough is Ryan's next step, due on the walkthrough day.
           assignee = case when target = 'walkthrough' then 'Ryan' else t.assignee end,
           status = case when handed_off then 'done'::public.follow_up_status
                         when target = 'walkthrough' then 'open'::public.follow_up_status else t.status end,
           due_date = case when handed_off then null when target = 'walkthrough' then coalesce(walk_start, t.due_date) else t.due_date end,
           snooze_until = case when handed_off or target = 'walkthrough' then null else t.snooze_until end,
           completed_at = case when handed_off then coalesce(t.completed_at, now())
                               when target = 'walkthrough' then null else t.completed_at end,
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
