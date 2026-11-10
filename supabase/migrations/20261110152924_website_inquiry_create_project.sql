-- Website inquiry -> customer + project in one step (Jorge, 2026-11-10:
-- "create the project already without me doing it").
--
-- create_project_from_website_inquiry(todo, status) is the single code path
-- behind the Penney MCP tool, the inquiry page button and the stage job:
--   * reuses a project that is already linked (inquiry, its lead, or the
--     customer's recent pre-construction project) instead of duplicating it;
--   * otherwise finds the customer by the inquiry email or creates one from
--     the inquiry (name, email, phone, town, walkthrough address);
--   * creates the project with the inquiry's scope, type, town and
--     referral details, links it to the inquiry (and lead), and moves the
--     inquiry stage forward the same way advance_website_inquiries does.
--
-- advance_website_inquiries now creates the project itself (status lead)
-- once a NEW inquiry shows real engagement: the homeowner emailed back or a
-- walkthrough invitation went out. Inquiries received before this shipped
-- are left alone and can be converted on request.

create or replace function public.create_project_from_website_inquiry(
  p_todo_id uuid,
  p_status text default 'lead',
  p_actor uuid default null,
  p_update_stage boolean default true
) returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  inquiry public.todos%rowtype;
  w jsonb;
  rank_of constant jsonb := '{"new":0,"contacted":1,"lead":2,"walkthrough":3,"qualified":4,"estimating":5,"proposal_sent":6,"won":7}';
  actor uuid;
  email_value text; full_name text; first_name text; last_name text; phone_digits text; phone_value text;
  town text; address text; site text; ptype text; type_label text; message text; ref text;
  v_customer_id uuid; v_project_id uuid; v_project_number text; v_project_status text; v_project_name text;
  created boolean := false; customer_created boolean := false; linked_how text;
  stage text; project_stage text; handed_off boolean;
begin
  -- Server-side callers only (the app's server action after its inquiry-team
  -- check, the Penney MCP, the stage job). They name the acting person.
  if current_user not in ('service_role','postgres') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_status not in ('lead','estimating') then
    raise exception 'A new project starts as lead or estimating';
  end if;
  actor := coalesce((select id from public.profiles where id = p_actor),
                    (select id from public.profiles where email = 'jbetancur@penneyconstructioninc.com'));

  select * into inquiry from public.todos where id = p_todo_id and source = 'website' for update;
  if not found then raise exception 'Website inquiry not found'; end if;
  if coalesce(inquiry.intake_status,'new') = 'spam' then raise exception 'This inquiry is marked spam. Reopen it before creating a project.'; end if;
  w := coalesce(inquiry.website_inquiry, '{}'::jsonb);
  email_value := lower(trim(coalesce(w->>'email','')));
  if email_value = '' then raise exception 'The inquiry has no email, so there is no customer to create'; end if;
  ref := coalesce(nullif(w->>'reference',''), 'WEB-'||upper(left(replace(inquiry.id::text,'-',''),12)));

  -- 1. A project that already belongs to this inquiry wins.
  select p.id into v_project_id from public.projects p
   where p.id = inquiry.project_id and p.status <> 'cancelled';
  if v_project_id is not null then linked_how := 'inquiry'; end if;
  if v_project_id is null and inquiry.lead_id is not null then
    select p.id into v_project_id from public.leads l join public.projects p on p.id = l.project_id
     where l.id = inquiry.lead_id and p.status <> 'cancelled';
    if v_project_id is not null then linked_how := 'lead'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('website-project:'||email_value, 0));
  select c.id into v_customer_id from public.customers c
   where lower(trim(c.email)) = email_value order by c.created_at desc limit 1;

  -- 2. The same homeowner's open pre-construction project (same rule window
  --    as the stage job, widened to 180 days for a repeat inquiry).
  if v_project_id is null and v_customer_id is not null then
    select p.id into v_project_id from public.projects p
     where p.customer_id = v_customer_id
       and p.status in ('lead','estimating','waiting_for_approval','proposal_sent')
       and p.created_at >= inquiry.created_at - interval '180 days'
     order by p.created_at desc limit 1;
    if v_project_id is not null then linked_how := 'customer'; end if;
  end if;

  if v_project_id is null then
    -- 3. Create the customer from the inquiry when there is none.
    -- The card's contact name and the form's name field can differ ("Dan
    -- Flanagan" vs "Flanagan"): keep whichever has more words.
    full_name := regexp_replace(trim(coalesce(inquiry.contact_name, '')), '\s+', ' ', 'g');
    if array_length(regexp_split_to_array(trim(coalesce(w->>'name','')), '\s+'), 1)
       > array_length(regexp_split_to_array(coalesce(nullif(full_name,''), '-'), '\s+'), 1)
       or full_name = '' then
      full_name := regexp_replace(trim(coalesce(w->>'name', '')), '\s+', ' ', 'g');
    end if;
    if full_name = '' then full_name := 'Website Inquiry'; end if;
    if full_name = lower(full_name) or full_name = upper(full_name) then full_name := initcap(full_name); end if;
    if position(' ' in full_name) = 0 then
      first_name := ''; last_name := full_name;
    else
      first_name := split_part(full_name, ' ', 1);
      last_name := trim(substr(full_name, length(first_name) + 1));
    end if;
    phone_digits := regexp_replace(coalesce(w->>'phone',''), '\D', '', 'g');
    if length(phone_digits) = 11 and left(phone_digits,1) = '1' then phone_digits := substr(phone_digits, 2); end if;
    phone_value := case when length(phone_digits) = 10
                        then substr(phone_digits,1,3)||'-'||substr(phone_digits,4,3)||'-'||substr(phone_digits,7,4)
                        else nullif(trim(coalesce(w->>'phone','')), '') end;
    town := nullif(trim(coalesce(w->>'town','')), '');
    if town = lower(town) or town = upper(town) then town := initcap(town); end if;
    address := nullif(trim(coalesce(w#>>'{walkthrough,address}', w#>>'{propertyContext,property,address}', '')), '');

    if v_customer_id is null then
      insert into public.customers(first_name, last_name, email, phone, address, city, state, notes, created_by)
      values (first_name, last_name, email_value, phone_value, address, town, 'MA',
              'Created from website inquiry '||ref||' on '||to_char(now() at time zone 'America/New_York','MM/DD/YYYY')||'.', actor)
      returning id into v_customer_id;
      customer_created := true;
    end if;

    -- 4. Create the project.
    ptype := case w->>'projectType'
      when 'adu' then 'new_construction' when 'whole-home' then 'remodel' when 'historic' then 'remodel'
      when 'lower-level' then 'remodel' when 'addition' then 'addition' when 'kitchen' then 'kitchen'
      when 'bathroom' then 'bathroom' when 'porch-deck' then 'deck' when 'deck' then 'deck'
      when 'roofing' then 'roofing' when 'siding' then 'siding' else 'other' end;
    type_label := case w->>'projectType'
      when 'adu' then 'ADU' when 'whole-home' then 'Whole-Home Renovation' when 'historic' then 'Historic Renovation'
      when 'lower-level' then 'Lower Level' when 'addition' then 'Addition' when 'kitchen' then 'Kitchen'
      when 'bathroom' then 'Bathroom' when 'porch-deck' then 'Porch & Deck' when 'deck' then 'Deck'
      when 'roofing' then 'Roofing' when 'siding' then 'Siding' else 'Project' end;
    site := coalesce(address, town);
    v_project_name := last_name||' '||type_label||coalesce(' — '||site, '');
    message := nullif(trim(coalesce(w->>'message','')), '');

    insert into public.projects(name, customer_id, status, project_type, description, address, city, state,
                                notes, referral_source, referral_detail, aliases, created_by)
    values (
      left(v_project_name, 200), v_customer_id, p_status, ptype,
      left(coalesce(message, inquiry.description, 'Website inquiry '||ref), 4000),
      address, town, 'MA',
      'Created from website inquiry '||ref||' (received '||to_char(inquiry.created_at at time zone 'America/New_York','MM/DD/YYYY')||')'
        ||case when p_actor is null and not p_update_stage
               then ' automatically after the homeowner engaged.' else '.' end
        ||coalesce(' Timeline: '||nullif(w->>'timeline','')||'.', ''),
      'website',
      concat_ws('; ', 'Website inquiry '||ref||' '||to_char(inquiry.created_at at time zone 'America/New_York','MM/DD/YY'),
                'Heard about us: '||nullif(w->>'heardAbout',''), 'Came from: '||nullif(w#>>'{source,referrer}',''),
                'Timeline: '||nullif(w->>'timeline','')),
      array_remove(array[last_name, nullif(full_name,''), address, ref], null),
      actor)
    returning id into v_project_id;
    created := true; linked_how := 'created';
  end if;

  select p.project_number, p.status, p.name, p.customer_id
    into v_project_number, v_project_status, v_project_name, v_customer_id
    from public.projects p where p.id = v_project_id;

  -- An existing lead-stage project moves to estimating when asked.
  if not created and p_status = 'estimating' and v_project_status = 'lead' then
    update public.projects set status = 'estimating', updated_at = now() where id = v_project_id;
    v_project_status := 'estimating';
  end if;

  update public.todos set project_id = v_project_id, updated_at = clock_timestamp()
   where id = p_todo_id and project_id is distinct from v_project_id;
  if inquiry.lead_id is not null then
    update public.leads set project_id = v_project_id, customer_id = coalesce(customer_id, v_customer_id), status = 'converted'
     where id = inquiry.lead_id and project_id is null;
  end if;

  -- Move the inquiry stage forward exactly like advance_website_inquiries.
  if p_update_stage then
    stage := coalesce(inquiry.intake_status, 'new');
    project_stage := case
      when v_project_status = 'lead' then 'lead'
      when v_project_status in ('estimating','waiting_for_approval') then 'estimating'
      when v_project_status = 'proposal_sent' then 'proposal_sent'
      when v_project_status in ('contracted','in_progress','audit','completed') then 'won' end;
    if project_stage is not null and stage in (select jsonb_object_keys(rank_of))
       and (rank_of->>project_stage)::int > (rank_of->>stage)::int then
      handed_off := project_stage in ('qualified','estimating','proposal_sent','won');
      update public.todos t
         set intake_status = project_stage,
             status = case when handed_off then 'done'::public.follow_up_status else t.status end,
             due_date = case when handed_off then null else t.due_date end,
             snooze_until = case when handed_off then null else t.snooze_until end,
             completed_at = case when handed_off then coalesce(t.completed_at, now()) else t.completed_at end,
             updated_at = clock_timestamp()
       where t.id = p_todo_id;
      insert into public.website_inquiry_stage_events(inquiry_id, from_status, to_status, reason, project_id)
      values (p_todo_id, stage, project_stage,
              'Project '||v_project_number||case when created then ' created from the inquiry' else ' linked' end, v_project_id);
    end if;
  end if;

  insert into public.activity_log(user_id, action, entity_type, entity_id, details)
  values (actor, case when created then 'website_inquiry_project_created' else 'website_inquiry_project_linked' end,
          'website_inquiry', p_todo_id,
          jsonb_build_object('project_id', v_project_id, 'project_number', v_project_number, 'customer_id', v_customer_id,
                             'customer_created', customer_created, 'linked', linked_how));

  return jsonb_build_object(
    'project_id', v_project_id, 'project_number', v_project_number, 'project_name', v_project_name,
    'status', v_project_status, 'customer_id', v_customer_id, 'created', created,
    'customer_created', customer_created, 'linked', linked_how, 'inquiry_id', p_todo_id, 'reference', ref);
end
$function$;

revoke all on function public.create_project_from_website_inquiry(uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.create_project_from_website_inquiry(uuid, text, uuid, boolean) to service_role;

-- Same as the live 20261110 version, plus: a new inquiry that reaches Lead
-- (homeowner answered) or Walkthrough (invitation sent) with no project gets
-- one created at status lead.
create or replace function public.advance_website_inquiries()
 returns integer
 language plpgsql
 set search_path to ''
as $function$
declare
  r record;
  rank_of constant jsonb := '{"new":0,"contacted":1,"lead":2,"walkthrough":3,"qualified":4,"estimating":5,"proposal_sent":6,"won":7}';
  -- Auto-create applies to inquiries received after this shipped.
  auto_create_from constant timestamptz := '2026-11-10 16:00:00+00';
  target text; reason text; project_stage text; handed_off boolean; walk_start timestamptz; moved integer := 0;
  v_found uuid; v_status text; v_number text; made jsonb;
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
    v_found := r.found_project; v_status := r.project_status; v_number := r.project_number;
    if r.team_emailed and (rank_of->>target)::int < 1 then target := 'contacted'; reason := 'Team emailed the homeowner'; end if;
    if r.client_answered and (rank_of->>target)::int < 2 then target := 'lead'; reason := 'Homeowner answered'; end if;
    if r.invite_subject is not null and (rank_of->>target)::int < 3 then
      target := 'walkthrough'; reason := 'Calendar invite sent: '||left(r.invite_subject, 160);
      walk_start := coalesce(public.website_invite_start(r.invite_subject), r.requested_start::timestamptz);
    end if;
    -- A real lead with no project gets one, so nobody has to type it in.
    if v_found is null and target in ('lead','walkthrough') and r.created_at >= auto_create_from then
      made := public.create_project_from_website_inquiry(r.id, 'lead', null, false);
      v_found := (made->>'project_id')::uuid; v_status := made->>'status'; v_number := made->>'project_number';
      reason := coalesce(reason||'; ', '')||'project '||v_number||case when (made->>'created')::boolean then ' created' else ' linked' end;
    end if;
    project_stage := case
      when v_status = 'lead' then 'lead'
      when v_status in ('estimating','waiting_for_approval') then 'estimating'
      when v_status = 'proposal_sent' then 'proposal_sent'
      when v_status in ('contracted','in_progress','audit','completed') then 'won'
      when v_status = 'cancelled' then 'closed' end;
    if project_stage = 'closed' then
      -- Only a project this inquiry was already linked to can close it.
      if r.project_id is not null then target := 'closed'; reason := 'Project '||v_number||' was cancelled'; end if;
    elsif project_stage is not null and (rank_of->>project_stage)::int > (rank_of->>target)::int then
      target := project_stage; reason := 'Project '||v_number||' is '||replace(v_status,'_',' ');
    end if;
    if target is not distinct from r.stage and (v_found is null or r.project_id is not null) then continue; end if;
    handed_off := target in ('qualified','estimating','proposal_sent','won','closed','spam');
    update public.todos t
       set intake_status = target,
           project_id = coalesce(t.project_id, v_found),
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
      values (r.id, r.stage, target, reason, v_found);
      moved := moved + 1;
    end if;
  end loop;
  return moved;
end $function$;
