-- Email attempts are reserved before Gmail is called. Only the server may
-- mutate them; the named inquiry team shares the reviewable send history.
create table public.website_inquiry_emails (
  id uuid primary key,
  inquiry_id uuid references public.todos(id) on delete set null,
  sender_profile_id uuid not null references public.profiles(id),
  recipient_email text not null,
  subject text not null check (length(btrim(subject)) between 1 and 500),
  body text not null check (length(btrim(body)) between 1 and 50000),
  status text not null default 'sending' check (status in ('sending','sent','uncertain','failed')),
  gmail_message_id text,
  gmail_thread_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text,
  constraint website_inquiry_email_sent_receipt check (
    status <> 'sent' or (nullif(btrim(gmail_message_id),'') is not null and sent_at is not null)
  )
);
create index website_inquiry_emails_history_idx on public.website_inquiry_emails(inquiry_id,created_at desc);
create index website_inquiry_emails_sender_idx on public.website_inquiry_emails(sender_profile_id);
create unique index website_inquiry_emails_pending_idx on public.website_inquiry_emails(inquiry_id)
  where inquiry_id is not null and status in ('sending','uncertain');
alter table public.website_inquiry_emails enable row level security;
revoke all on table public.website_inquiry_emails from public,anon,authenticated;
grant select on table public.website_inquiry_emails to authenticated;
grant all on table public.website_inquiry_emails to service_role;
create policy "Named team reads inquiry email history" on public.website_inquiry_emails
for select to authenticated using ((select public.can_access_website_inquiries()));

-- Invoker deletion needs SELECT as well as DELETE to remove every recipient's
-- inquiry notification. All other notification access stays recipient-only.
create policy "Named team reads inquiry notification cleanup rows" on public.app_notifications
for select to authenticated using (
  source_type in ('website_inquiry','website_inquiry_overdue')
  and (select public.can_access_website_inquiries())
  and exists(select 1 from public.todos t where t.id=source_id and t.source='website')
);
create policy "Named team deletes inquiry notification cleanup rows" on public.app_notifications
for delete to authenticated using (
  source_type in ('website_inquiry','website_inquiry_overdue')
  and (select public.can_access_website_inquiries())
  and exists(select 1 from public.todos t where t.id=source_id and t.source='website')
);
grant delete on table public.app_notifications to authenticated;

create or replace function public.begin_website_inquiry_email(
  p_email_id uuid,p_todo_id uuid,p_sender_profile_id uuid,p_recipient_email text,
  p_subject text,p_body text,p_expected_updated_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  inquiry public.todos%rowtype;
  attempt public.website_inquiry_emails%rowtype;
  recipient text := lower(btrim(p_recipient_email));
  inquiry_recipient text;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  if not exists(select 1 from public.website_inquiry_members where profile_id=p_sender_profile_id) then
    raise exception 'Website inquiry access required' using errcode='42501';
  end if;
  if p_email_id is null or p_todo_id is null or p_expected_updated_at is null
    or recipient is null or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    or p_subject is null or length(btrim(p_subject)) not between 1 and 500 or p_subject ~ E'[\r\n]'
    or p_body is null or length(btrim(p_body)) not between 1 and 50000 then
    raise exception 'Review the recipient, subject and message before sending';
  end if;
  -- Same request key cannot be claimed by concurrent requests to different rows.
  perform pg_advisory_xact_lock(hashtextextended('website-inquiry-email:'||p_email_id::text,0));
  select * into attempt from public.website_inquiry_emails where id=p_email_id;
  if found then
    if attempt.inquiry_id is distinct from p_todo_id or attempt.sender_profile_id is distinct from p_sender_profile_id
      or attempt.recipient_email is distinct from recipient or attempt.subject is distinct from p_subject
      or attempt.body is distinct from p_body then raise exception 'This email request key already belongs to a different message'; end if;
    if attempt.status <> 'failed' then
      return jsonb_build_object('id',attempt.id,'status',attempt.status,'claimed',false,
        'gmail_message_id',attempt.gmail_message_id,'gmail_thread_id',attempt.gmail_thread_id,'sent_at',attempt.sent_at);
    end if;
  end if;
  -- Delete uses the same row lock. Once this reservation commits, its pending
  -- status blocks deletion until the server records a confirmed Gmail receipt.
  select * into inquiry from public.todos where id=p_todo_id and source='website' for update;
  if not found then raise exception 'Inquiry not found'; end if;
  if inquiry.updated_at is distinct from p_expected_updated_at then raise exception 'This inquiry changed. Refresh before sending.'; end if;
  inquiry_recipient := lower(btrim(coalesce(nullif(btrim(inquiry.website_inquiry->>'email'),''),substring(inquiry.description from 'Email: ([^\n\r]+)'))));
  if inquiry_recipient is distinct from recipient then raise exception 'The recipient no longer matches this inquiry. Refresh before sending.'; end if;
  if exists(select 1 from public.website_inquiry_emails where inquiry_id=p_todo_id and status in ('sending','uncertain')) then
    raise exception 'An email is already sending or needs verification. Check the email history before trying again.';
  end if;
  -- A definite Gmail HTTP rejection can be retried only through another
  -- explicit user action with the same reviewed payload and fresh version.
  select * into attempt from public.website_inquiry_emails where id=p_email_id for update;
  if found then
    if attempt.status <> 'failed' then
      return jsonb_build_object('id',attempt.id,'status',attempt.status,'claimed',false,
        'gmail_message_id',attempt.gmail_message_id,'gmail_thread_id',attempt.gmail_thread_id,'sent_at',attempt.sent_at);
    end if;
    update public.website_inquiry_emails set status='sending',error=null where id=p_email_id;
    return jsonb_build_object('id',p_email_id,'status','sending','claimed',true,
      'gmail_message_id',null,'gmail_thread_id',null,'sent_at',null);
  end if;
  insert into public.website_inquiry_emails(id,inquiry_id,sender_profile_id,recipient_email,subject,body)
    values(p_email_id,p_todo_id,p_sender_profile_id,recipient,p_subject,p_body);
  return jsonb_build_object('id',p_email_id,'status','sending','claimed',true,
    'gmail_message_id',null,'gmail_thread_id',null,'sent_at',null);
end $$;
revoke all on function public.begin_website_inquiry_email(uuid,uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.begin_website_inquiry_email(uuid,uuid,uuid,text,text,text,timestamptz) to service_role;

create or replace function public.finish_website_inquiry_email(p_email_id uuid,p_gmail_message_id text,p_gmail_thread_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  attempt public.website_inquiry_emails%rowtype;
  target_id uuid;
  sent_stamp timestamptz := clock_timestamp();
  inquiry_stamp timestamptz;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  if nullif(btrim(p_gmail_message_id),'') is null then raise exception 'A confirmed Gmail message ID is required'; end if;
  select inquiry_id into target_id from public.website_inquiry_emails where id=p_email_id;
  if not found then raise exception 'Email attempt not found'; end if;
  -- Match the inquiry -> email lock order used by deletion and new claims.
  if target_id is not null then perform 1 from public.todos where id=target_id for update; end if;
  select * into attempt from public.website_inquiry_emails where id=p_email_id for update;
  if attempt.status='sent' then
    if attempt.gmail_message_id is distinct from p_gmail_message_id then raise exception 'A different Gmail receipt is already recorded'; end if;
    select updated_at into inquiry_stamp from public.todos where id=attempt.inquiry_id;
    return jsonb_build_object('id',attempt.id,'status','sent','sent_at',attempt.sent_at,'inquiry_updated_at',inquiry_stamp);
  end if;
  if attempt.inquiry_id is null then raise exception 'The email inquiry is unavailable'; end if;
  update public.website_inquiry_emails set status='sent',gmail_message_id=p_gmail_message_id,
    gmail_thread_id=nullif(p_gmail_thread_id,''),sent_at=sent_stamp,error=null where id=p_email_id;
  -- Preserve all later intake states and the user's existing follow-up date.
  update public.todos set intake_status='contacted',updated_at=sent_stamp
    where id=attempt.inquiry_id and source='website' and intake_status='new';
  select updated_at into inquiry_stamp from public.todos where id=attempt.inquiry_id;
  insert into public.activity_log(user_id,action,entity_type,entity_id,details)
    values(attempt.sender_profile_id,'website_inquiry_emailed','website_inquiry',attempt.inquiry_id,
      jsonb_build_object('email_id',attempt.id,'recipient_email',attempt.recipient_email,'subject',attempt.subject,
        'gmail_message_id',p_gmail_message_id,'gmail_thread_id',nullif(p_gmail_thread_id,'')));
  return jsonb_build_object('id',attempt.id,'status','sent','sent_at',sent_stamp,'inquiry_updated_at',inquiry_stamp);
end $$;
revoke all on function public.finish_website_inquiry_email(uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_website_inquiry_email(uuid,text,text) to service_role;

create or replace function public.mark_website_inquiry_email_uncertain(p_email_id uuid,p_error text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare attempt public.website_inquiry_emails%rowtype;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into attempt from public.website_inquiry_emails where id=p_email_id for update;
  if not found then raise exception 'Email attempt not found'; end if;
  if attempt.status <> 'sent' then
    update public.website_inquiry_emails set status='uncertain',error=left(coalesce(p_error,'Gmail delivery could not be confirmed'),2000) where id=p_email_id;
  end if;
  return jsonb_build_object('id',p_email_id,'status',case when attempt.status='sent' then 'sent' else 'uncertain' end);
end $$;
revoke all on function public.mark_website_inquiry_email_uncertain(uuid,text) from public,anon,authenticated;
grant execute on function public.mark_website_inquiry_email_uncertain(uuid,text) to service_role;

create or replace function public.mark_website_inquiry_email_failed(p_email_id uuid,p_error text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare attempt public.website_inquiry_emails%rowtype;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into attempt from public.website_inquiry_emails where id=p_email_id for update;
  if not found then raise exception 'Email attempt not found'; end if;
  -- A definite rejection must never erase a successful or ambiguous send.
  if attempt.status in ('sending','failed') then
    update public.website_inquiry_emails set status='failed',error=left(coalesce(p_error,'Gmail rejected the send request'),2000) where id=p_email_id;
    attempt.status := 'failed';
  end if;
  return jsonb_build_object('id',p_email_id,'status',attempt.status);
end $$;
revoke all on function public.mark_website_inquiry_email_failed(uuid,text) from public,anon,authenticated;
grant execute on function public.mark_website_inquiry_email_failed(uuid,text) to service_role;

-- Also protect generic Todo delete paths from deleting an in-flight send.
create or replace function public.guard_website_inquiry_pending_delete()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.source='website' and exists (
    select 1 from public.website_inquiry_emails where inquiry_id=old.id and status in ('sending','uncertain')
  ) then raise exception 'An email is still sending or needs verification. Resolve it before deleting this inquiry.'; end if;
  return old;
end $$;
revoke all on function public.guard_website_inquiry_pending_delete() from public,anon,authenticated;
create trigger guard_website_inquiry_pending_delete before delete on public.todos
for each row execute function public.guard_website_inquiry_pending_delete();

create or replace function public.delete_website_inquiry(p_todo_id uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare inquiry public.todos%rowtype;
begin
  if not public.can_access_website_inquiries() then raise exception 'Website inquiry access required' using errcode='42501'; end if;
  select * into inquiry from public.todos where id=p_todo_id and source='website' for update;
  if not found then raise exception 'Inquiry not found'; end if;
  if inquiry.updated_at is distinct from p_expected_updated_at then raise exception 'This inquiry changed. Refresh before deleting.'; end if;
  if exists(select 1 from public.website_inquiry_emails where inquiry_id=p_todo_id and status in ('sending','uncertain')) then
    raise exception 'An email is still sending or needs verification. Resolve it before deleting this inquiry.';
  end if;
  delete from public.app_notifications where source_id=p_todo_id and source_type in ('website_inquiry','website_inquiry_overdue');
  insert into public.activity_log(user_id,action,entity_type,entity_id,details)
    values(auth.uid(),'website_inquiry_deleted','website_inquiry',p_todo_id,
      jsonb_build_object('contact_name',inquiry.contact_name,'reference',inquiry.website_inquiry->>'reference',
        'intake_status',inquiry.intake_status,'lead_id',inquiry.lead_id));
  delete from public.todos where id=p_todo_id;
  return jsonb_build_object('id',p_todo_id,'deleted',true);
end $$;
revoke all on function public.delete_website_inquiry(uuid,timestamptz) from public,anon;
grant execute on function public.delete_website_inquiry(uuid,timestamptz) to authenticated;
