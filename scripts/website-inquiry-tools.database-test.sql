-- Transaction-only verification. Uses synthetic inquiries/messages and never
-- calls Gmail. No existing inquiry is edited or deleted; all fixtures roll back.
begin;
do $$
declare
  inquiry_id uuid := gen_random_uuid();
  manual_id uuid := gen_random_uuid();
  email_id uuid := gen_random_uuid();
  second_email_id uuid := gen_random_uuid();
  ordinary_notification_id uuid := gen_random_uuid();
  actor_id uuid;
  denied_id uuid;
  linked_lead_id uuid := gen_random_uuid();
  stamp timestamptz;
  original_due timestamptz;
  response jsonb;
  guarded boolean;
  audit_count bigint;
  row_count bigint;
  payload jsonb;
begin
  select profile_id into actor_id from public.website_inquiry_members where assignee_name='Ryan';
  select p.id into denied_id from public.profiles p where not exists(select 1 from public.website_inquiry_members m where m.profile_id=p.id) order by p.email limit 1;
  if actor_id is null or denied_id is null then raise exception 'Required verification identities unavailable'; end if;
  payload := jsonb_build_object('name','Inquiry tools verification','town','Beverly',
    'email','inquiry-tools-'||inquiry_id::text||'@example.invalid','projectType','other',
    'description','Transaction-only inquiry tools verification');
  execute 'set local role service_role';
  -- Explicit lead_number avoids advancing the non-transactional live sequence.
  insert into public.leads(id,lead_number,first_name,last_name,created_by)
    values(linked_lead_id,'VERIFY-'||linked_lead_id::text,'Inquiry tools','Verification',actor_id);
  perform public.submit_website_inquiry(inquiry_id,payload,'');
  insert into public.todos(id,contact_name,contact_type,description,source,created_by)
    values(manual_id,'Unrelated Todo verification','client','Transaction-only manual Todo','manual',actor_id);
  insert into public.app_notifications(id,recipient_profile_id,kind,title,body,url,source_type,source_id)
    values(ordinary_notification_id,actor_id,'help','Unrelated notification verification','Transaction-only','/command-center','company_post',inquiry_id);
  select updated_at,due_date into stamp,original_due from public.todos where id=inquiry_id;

  guarded := false;
  begin
    perform public.begin_website_inquiry_email(email_id,inquiry_id,denied_id,payload->>'email','Reviewed subject','Reviewed message',stamp);
  exception when insufficient_privilege then guarded := true;
  end;
  if not guarded then raise exception 'Unapproved sender could reserve a send'; end if;
  guarded := false;
  begin
    perform public.begin_website_inquiry_email(email_id,inquiry_id,actor_id,'wrong@example.invalid','Reviewed subject','Reviewed message',stamp);
  exception when raise_exception then guarded := sqlerrm like 'The recipient no longer matches%';
  end;
  if not guarded then raise exception 'Wrong recipient accepted'; end if;
  guarded := false;
  begin
    perform public.begin_website_inquiry_email(email_id,inquiry_id,actor_id,payload->>'email','Reviewed subject','Reviewed message',stamp-interval '1 second');
  exception when raise_exception then guarded := sqlerrm like 'This inquiry changed%';
  end;
  if not guarded then raise exception 'Stale email version accepted'; end if;

  response := public.begin_website_inquiry_email(email_id,inquiry_id,actor_id,payload->>'email','Reviewed subject','Reviewed message',stamp);
  if response->>'claimed' is distinct from 'true' then raise exception 'Initial reservation failed'; end if;
  guarded := false;
  begin delete from public.todos where id=inquiry_id;
  exception when raise_exception then guarded := sqlerrm like 'An email is still sending%'; end;
  if not guarded then raise exception 'Pending send could be deleted'; end if;
  response := public.begin_website_inquiry_email(email_id,inquiry_id,actor_id,payload->>'email','Reviewed subject','Reviewed message',stamp);
  if response->>'claimed' is distinct from 'false' then raise exception 'Same request claimed twice'; end if;
  guarded := false;
  begin
    perform public.begin_website_inquiry_email(email_id,inquiry_id,actor_id,payload->>'email','Changed subject','Reviewed message',stamp);
  exception when raise_exception then guarded := sqlerrm like 'This email request key already belongs%';
  end;
  if not guarded then raise exception 'Request key accepted changed content'; end if;
  guarded := false;
  begin
    perform public.begin_website_inquiry_email(second_email_id,inquiry_id,actor_id,payload->>'email','Second subject','Second message',stamp);
  exception when raise_exception then guarded := sqlerrm like 'An email is already sending%';
  end;
  if not guarded then raise exception 'Concurrent different request key accepted'; end if;

  response := public.mark_website_inquiry_email_failed(email_id,'Definite HTTP rejection test');
  if response->>'status' is distinct from 'failed' then raise exception 'Definite failure not recorded'; end if;
  response := public.begin_website_inquiry_email(email_id,inquiry_id,actor_id,payload->>'email','Reviewed subject','Reviewed message',stamp);
  if response->>'claimed' is distinct from 'true' then raise exception 'Explicit retry after definite failure blocked'; end if;
  perform public.mark_website_inquiry_email_uncertain(email_id,'Ambiguous transport test');
  response := public.mark_website_inquiry_email_failed(email_id,'Must not downgrade uncertainty');
  if response->>'status' is distinct from 'uncertain' then raise exception 'Uncertain send became retryable'; end if;
  response := public.begin_website_inquiry_email(email_id,inquiry_id,actor_id,payload->>'email','Reviewed subject','Reviewed message',stamp);
  if response->>'claimed' is distinct from 'false' or response->>'status' is distinct from 'uncertain' then raise exception 'Ambiguous send retried'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',denied_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',denied_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.website_inquiry_emails where id=email_id) then raise exception 'Unapproved user can read email history'; end if;
  guarded := false;
  begin perform public.delete_website_inquiry(inquiry_id,stamp);
  exception when insufficient_privilege then guarded := true; end;
  if not guarded then raise exception 'Unapproved user can delete inquiry'; end if;
  delete from public.app_notifications where source_id=inquiry_id;
  get diagnostics row_count = row_count;
  if row_count <> 0 then raise exception 'Unapproved user can delete inquiry notifications'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if not exists(select 1 from public.website_inquiry_emails where id=email_id) then raise exception 'Named team cannot read shared email history'; end if;
  guarded := false;
  begin update public.website_inquiry_emails set status='failed' where id=email_id;
  exception when insufficient_privilege then guarded := true; end;
  if not guarded then raise exception 'Client can mutate protected email history'; end if;
  guarded := false;
  begin perform public.finish_website_inquiry_email(email_id,'fake-client-receipt','fake-thread');
  exception when insufficient_privilege then guarded := true; end;
  if not guarded then raise exception 'Client can forge a sent receipt'; end if;
  guarded := false;
  begin perform public.begin_website_inquiry_email(second_email_id,inquiry_id,actor_id,payload->>'email','Second subject','Second message',stamp);
  exception when insufficient_privilege then guarded := true; end;
  if not guarded then raise exception 'Client can directly reserve send attempts'; end if;
  guarded := false;
  begin perform public.delete_website_inquiry(inquiry_id,stamp);
  exception when raise_exception then guarded := sqlerrm like 'An email is still sending%'; end;
  if not guarded then raise exception 'Delete RPC removed uncertain inquiry'; end if;
  guarded := false;
  begin delete from public.todos where id=inquiry_id;
  exception when raise_exception then guarded := sqlerrm like 'An email is still sending%'; end;
  if not guarded then raise exception 'Generic delete removed uncertain inquiry'; end if;
  -- The pending-send trigger leaves ordinary Todo deletion unchanged.
  delete from public.todos where id=manual_id;
  get diagnostics row_count = row_count;
  if row_count <> 1 then raise exception 'Ordinary Todo deletion changed'; end if;
  execute 'reset role';

  execute 'set local role service_role';
  response := public.finish_website_inquiry_email(email_id,'verification-message-1','verification-thread-1');
  if response->>'status' is distinct from 'sent' then raise exception 'Confirmed receipt not recorded'; end if;
  if not exists(select 1 from public.todos where id=inquiry_id and intake_status='contacted' and due_date=original_due) then
    raise exception 'Confirmed email did not mark new inquiry contacted or changed due date';
  end if;
  perform public.finish_website_inquiry_email(email_id,'verification-message-1','verification-thread-1');
  select count(*) into audit_count from public.activity_log where entity_id=inquiry_id and action='website_inquiry_emailed';
  if audit_count <> 1 then raise exception 'Repeated finish duplicated audit'; end if;
  perform public.mark_website_inquiry_email_uncertain(email_id,'Late failure must not erase sent');
  if not exists(select 1 from public.website_inquiry_emails where id=email_id and status='sent') then raise exception 'Sent receipt was downgraded'; end if;
  update public.todos set intake_status='walkthrough',lead_id=linked_lead_id where id=inquiry_id;
  select updated_at into stamp from public.todos where id=inquiry_id;
  perform public.begin_website_inquiry_email(second_email_id,inquiry_id,actor_id,payload->>'email','Second subject','Second message',stamp);
  perform public.finish_website_inquiry_email(second_email_id,'verification-message-2','verification-thread-1');
  if not exists(select 1 from public.todos where id=inquiry_id and intake_status='walkthrough' and due_date=original_due) then
    raise exception 'Sending changed an advanced intake state or due date';
  end if;
  select updated_at into stamp from public.todos where id=inquiry_id;
  execute 'reset role';

  execute 'set local role authenticated';
  guarded := false;
  begin perform public.delete_website_inquiry(inquiry_id,stamp-interval '1 second');
  exception when raise_exception then guarded := sqlerrm like 'This inquiry changed%'; end;
  if not guarded then raise exception 'Stale delete was accepted'; end if;
  response := public.delete_website_inquiry(inquiry_id,stamp);
  if response->>'deleted' is distinct from 'true' then raise exception 'Confirmed delete failed'; end if;
  execute 'reset role';
  if exists(select 1 from public.todos where id=inquiry_id) then raise exception 'Deleted inquiry remains'; end if;
  if exists(select 1 from public.app_notifications where source_id=inquiry_id and source_type in ('website_inquiry','website_inquiry_overdue')) then
    raise exception 'Other recipients retained stale inquiry notifications';
  end if;
  if not exists(select 1 from public.app_notifications where id=ordinary_notification_id) then raise exception 'Unrelated notification deleted'; end if;
  if not exists(select 1 from public.leads where id=linked_lead_id) then raise exception 'Linked lead deleted'; end if;
  if (select count(*) from public.website_inquiry_emails where id in (email_id,second_email_id) and inquiry_id is null and status='sent') <> 2 then
    raise exception 'Delete did not preserve sent email history';
  end if;
  if (select count(*) from public.activity_log where entity_id=inquiry_id and action='website_inquiry_deleted') <> 1 then raise exception 'Delete audit missing'; end if;
end $$;
rollback;
select 'PASS: restricted email history; idempotent claims; explicit failed retry; uncertain duplicate/delete protection; confirmed state/audit; delete preserves leads and sent history; all fixtures rolled back' as result;
