-- Run as postgres after the named-access migration. Every temporary change
-- rolls back, and all authorization assertions run as authenticated users.
begin;
do $$
declare
  person record;
  expected boolean;
  expected_inquiries bigint;
  expected_other_todos bigint;
  expected_activity bigint;
  visible_count bigint;
  membership_count bigint;
  changed_count bigint;
  guarded boolean;
  checked integer := 0;
  admitted integer := 0;
  sample_id uuid;
begin
  select count(*), min(id::text)::uuid into expected_inquiries, sample_id
    from public.todos where source='website';
  select count(*) into expected_other_todos from public.todos where source is distinct from 'website';
  select count(*) into expected_activity from public.activity_log where entity_type='website_inquiry';
  if expected_inquiries = 0 then raise exception 'Need an existing inquiry to verify visibility'; end if;
  if (select count(*) from public.website_inquiry_members) <> 5 then raise exception 'Expected five seated accounts'; end if;

  for person in select p.id,p.email from public.profiles p order by p.email loop
    expected := lower(person.email) in (
      'jbetancur@penneyconstructioninc.com','jorgebetancurfx@gmail.com',
      'rpenney@penneyconstructioninc.com','nsmith@penneyconstructioninc.com',
      'spenney@penneyconstructioninc.com'
    );
    perform set_config('request.jwt.claim.sub',person.id::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',person.id,'role','authenticated')::text,true);
    execute 'set local role authenticated';

    if public.can_access_website_inquiries() is distinct from expected then
      raise exception 'Access helper mismatch for %',person.email;
    end if;
    select count(*) into visible_count from public.todos where source='website';
    if visible_count <> (case when expected then expected_inquiries else 0 end) then
      raise exception 'Inquiry visibility mismatch for %: %',person.email,visible_count;
    end if;
    select count(*) into visible_count from public.todos where source is distinct from 'website';
    if visible_count <> expected_other_todos then raise exception 'Unrelated Todos changed for %',person.email; end if;
    select count(*) into visible_count from public.activity_log where entity_type='website_inquiry';
    if visible_count <> (case when expected then expected_activity else 0 end) then
      raise exception 'Inquiry activity visibility mismatch for %',person.email;
    end if;
    select count(*) into membership_count from public.website_inquiry_members;
    if membership_count <> (case when expected then 1 else 0 end) then
      raise exception 'Membership enumeration mismatch for %',person.email;
    end if;

    -- Table privileges reject escalation even if a caller knows a member UUID.
    guarded := false;
    begin
      update public.website_inquiry_members set notify_all = notify_all where false;
    exception when insufficient_privilege then guarded := true;
    end;
    if not guarded then raise exception 'Membership write allowed for %',person.email; end if;

    if not expected then
      select count(*) into visible_count from public.app_notifications
        where source_type in ('website_inquiry','website_inquiry_overdue');
      if visible_count <> 0 then raise exception 'Inquiry notifications visible for %',person.email; end if;
      update public.todos set assignee=assignee where id=sample_id;
      get diagnostics changed_count = row_count;
      if changed_count <> 0 then raise exception 'Direct inquiry update allowed for %',person.email; end if;
      guarded := false;
      begin
        perform public.update_website_inquiry(sample_id,now(),'new','Shannon',now());
      exception when insufficient_privilege then guarded := true;
      end;
      if not guarded then raise exception 'Update RPC allowed for %',person.email; end if;
      guarded := false;
      begin
        perform public.convert_website_inquiry_to_lead(sample_id,null);
      exception when insufficient_privilege then guarded := true;
      end;
      if not guarded then raise exception 'Convert RPC allowed for %',person.email; end if;
    else
      -- Pass the authorization gate, but stop at validation without editing data.
      guarded := false;
      begin
        perform public.update_website_inquiry(sample_id,now(),'invalid-test-status','Shannon',now());
      exception when raise_exception then guarded := sqlerrm = 'Invalid inquiry status';
      end;
      if not guarded then raise exception 'Authorized update RPC blocked for %',person.email; end if;
      admitted := admitted + 1;
    end if;
    checked := checked + 1;
    execute 'reset role';
  end loop;
  if admitted <> 5 then raise exception 'Expected five admitted accounts, got %',admitted; end if;
  raise notice 'Verified % profiles; exactly % accounts can see website inquiries',checked,admitted;
end $$;
-- Exercise public intake, edits by the authorized team, and reminder routing
-- against one synthetic inquiry. No rows survive the enclosing rollback.
do $$
declare
  test_id uuid := gen_random_uuid();
  actor_id uuid;
  payload jsonb;
  submitted jsonb;
  submitted_again jsonb;
  changed jsonb;
  next_assignee text;
  stamp timestamptz;
  reminder_count integer;
begin
  select profile_id into actor_id from public.website_inquiry_members where assignee_name='Ryan';
  payload := jsonb_build_object(
    'name','Website access verification','town','Beverly',
    'email','website-access-verification-'||test_id::text||'@example.invalid',
    'projectType','other','description','Transaction-only website inquiry authorization verification'
  );
  execute 'set local role service_role';
  submitted := public.submit_website_inquiry(test_id,payload,'');
  submitted_again := public.submit_website_inquiry(test_id,payload,'');
  if submitted->>'ok' is distinct from 'true' or submitted_again is distinct from submitted then
    raise exception 'Public intake/idempotence regression';
  end if;
  if (select count(*) from public.todos where id=test_id and source='website') <> 1 then
    raise exception 'Public intake did not save exactly one inquiry';
  end if;
  if (select count(*) from public.app_notifications where source_id=test_id and source_type='website_inquiry') <> 2 then
    raise exception 'Public intake did not notify the existing two initial recipients';
  end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  foreach next_assignee in array array['Ryan','Nicole','Jorge','Shannon'] loop
    select updated_at into stamp from public.todos where id=test_id;
    changed := public.update_website_inquiry(test_id,stamp,'contacted',next_assignee,now()+interval '1 day');
    if changed->>'id' is distinct from test_id::text or
      not exists(select 1 from public.todos where id=test_id and assignee=next_assignee and intake_status='contacted') then
      raise exception 'Authorized assignment failed for %',next_assignee;
    end if;
  end loop;
  -- Reassign to Ryan so the cron must route a new notification to him.
  select updated_at into stamp from public.todos where id=test_id;
  perform public.update_website_inquiry(test_id,stamp,'contacted','Ryan',now()+interval '1 day');
  execute 'reset role';
  execute 'set local role service_role';
  reminder_count := public.remind_website_inquiries();
  if reminder_count < 1 or not exists (
    select 1 from public.app_notifications where source_id=test_id and recipient_profile_id=actor_id
      and source_type='website_inquiry'
  ) then raise exception 'Reassigned inquiry reminder did not reach Ryan'; end if;
  if exists (
    select 1 from public.app_notifications n
    where n.source_id=test_id and n.source_type in ('website_inquiry','website_inquiry_overdue')
      and not exists(select 1 from public.website_inquiry_members m where m.profile_id=n.recipient_profile_id)
  ) then raise exception 'Inquiry notification reached someone outside the named team'; end if;
  execute 'reset role';
end $$;
rollback;
select 'PASS: all profiles checked; exactly five named accounts; intake, all four assignees and reminders work; no persisted data changes' as result;
