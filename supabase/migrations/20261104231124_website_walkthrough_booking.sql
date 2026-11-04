-- A durable reservation joins the reviewed inquiry email to Ryan's calendar.
-- External side effects are performed by the application after this transaction.
create table public.website_walkthrough_bookings (
  id uuid primary key,
  inquiry_id uuid not null references public.todos(id) on delete restrict,
  sender_profile_id uuid not null references public.profiles(id),
  recipient_email text not null,
  sender_email text not null,
  requested_updated_at timestamptz not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  address text not null check(length(btrim(address)) between 5 and 500),
  confirmation_source text not null,
  subject text not null,
  body text not null,
  confirmation_email_id uuid not null unique,
  operation_token uuid,
  operation_until timestamptz,
  status text not null default 'confirming' check(status in ('confirming','calendar_created','confirmed','needs_attention','failed')),
  calendar_event_id text,
  calendar_event_url text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint walkthrough_duration check(end_at=start_at+interval '1 hour'),
  constraint walkthrough_confirmed_receipt check(status not in ('calendar_created','confirmed') or calendar_event_id is not null)
);
create unique index website_walkthrough_active_inquiry_idx on public.website_walkthrough_bookings(inquiry_id) where status<>'failed';
create index website_walkthrough_availability_idx on public.website_walkthrough_bookings(start_at,end_at) where status<>'failed';
create index website_walkthrough_sender_idx on public.website_walkthrough_bookings(sender_profile_id);
alter table public.website_walkthrough_bookings enable row level security;
revoke all on table public.website_walkthrough_bookings from public,anon,authenticated;
grant select on table public.website_walkthrough_bookings to authenticated;
grant all on table public.website_walkthrough_bookings to service_role;
create policy "Named inquiry team reads walkthrough bookings" on public.website_walkthrough_bookings
for select to authenticated using ((select public.can_access_website_inquiries()));

create or replace function public.begin_website_walkthrough(
 p_id uuid,p_inquiry_id uuid,p_actor uuid,p_expected_updated_at timestamptz,
 p_start timestamptz,p_end timestamptz,p_address text,p_recipient text,p_sender text,
 p_subject text,p_body text,p_homeowner_confirmed boolean,p_confirmation_source text,p_operation_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.todos%rowtype; b public.website_walkthrough_bookings%rowtype; agreed text; r jsonb;
begin
 if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
 if not exists(select 1 from public.website_inquiry_members where profile_id=p_actor) then raise exception 'Website inquiry access required' using errcode='42501'; end if;
 if p_id is null or p_operation_id is null or p_inquiry_id is null or p_expected_updated_at is null or p_start is null or p_end is null
   or p_end<>p_start+interval '1 hour' or length(btrim(coalesce(p_address,''))) not between 5 and 500
   or length(btrim(coalesce(p_subject,''))) not between 1 and 200 or p_subject ~ E'[\r\n]'
   or length(btrim(coalesce(p_body,''))) not between 1 and 20000
   or coalesce(p_recipient,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
   or coalesce(p_sender,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then raise exception 'Review the walkthrough time, address and confirmation message'; end if;
 -- Serialize all Ryan reservations, including requests against different inquiries.
 perform pg_advisory_xact_lock(hashtextextended('website-walkthrough:ryan',0));
 select * into t from public.todos where id=p_inquiry_id and source='website' for update;
 if not found then raise exception 'Inquiry not found'; end if;
 select * into b from public.website_walkthrough_bookings where id=p_id for update;
 if found then
   if b.inquiry_id<>p_inquiry_id or b.sender_profile_id<>p_actor or b.start_at<>p_start or b.end_at<>p_end
     or b.address<>btrim(p_address) or b.recipient_email<>lower(btrim(p_recipient)) or b.sender_email<>lower(btrim(p_sender))
     or b.subject<>btrim(p_subject) or b.body<>p_body then raise exception 'This booking request belongs to a different reviewed confirmation'; end if;
   if b.status='failed' then raise exception 'This attempt did not create an appointment. Review a new booking request.'; end if;
   if b.status='confirmed' or b.operation_until>clock_timestamp() then return to_jsonb(b)||jsonb_build_object('claimed',false,'newly_created',false); end if;
   update public.website_walkthrough_bookings set operation_token=p_operation_id,operation_until=clock_timestamp()+interval '5 minutes'
     where id=p_id returning * into b;
   return to_jsonb(b)||jsonb_build_object('claimed',true,'newly_created',false);
 end if;
 if t.updated_at is distinct from p_expected_updated_at then raise exception 'This inquiry changed. Refresh before confirming.'; end if;
 if t.status='done' or t.intake_status in ('closed','spam') then raise exception 'Reopen this inquiry before scheduling'; end if;
 if lower(btrim(coalesce(nullif(t.website_inquiry->>'email',''),substring(t.description from 'Email: ([^\n\r]+)')))) is distinct from lower(btrim(p_recipient)) then raise exception 'The homeowner email changed. Refresh before confirming.'; end if;
 if p_start<now()+interval '1 hour' or p_start>now()+interval '60 days' then raise exception 'Choose a future walkthrough within 60 days'; end if;
 if exists(select 1 from public.website_walkthrough_bookings where inquiry_id=p_inquiry_id and status<>'failed') then raise exception 'This inquiry already has a booking. Open its saved confirmation.'; end if;
 if exists(select 1 from public.website_walkthrough_bookings where status<>'failed'
   and start_at<p_end+interval '30 minutes' and end_at>p_start-interval '30 minutes') then raise exception 'Ryan has another walkthrough at this time. Choose another opening.'; end if;
 if exists(select 1 from public.website_inquiry_emails where inquiry_id=p_inquiry_id and status in ('sending','uncertain')) then raise exception 'An email needs verification before a walkthrough can be confirmed'; end if;
 r:=t.website_inquiry->'walkthrough';
 if r is not null and (r->>'start')::timestamptz=p_start and (r->>'end')::timestamptz=p_end then
   agreed:='Requested by homeowner on website';
 elsif p_homeowner_confirmed is true and length(btrim(coalesce(p_confirmation_source,''))) between 6 and 1000 then
   agreed:=btrim(p_confirmation_source);
 else raise exception 'The homeowner must agree to this time before it is confirmed'; end if;
 insert into public.website_walkthrough_bookings(id,inquiry_id,sender_profile_id,recipient_email,sender_email,requested_updated_at,
   start_at,end_at,address,confirmation_source,subject,body,confirmation_email_id,operation_token,operation_until)
 values(p_id,p_inquiry_id,p_actor,lower(btrim(p_recipient)),lower(btrim(p_sender)),p_expected_updated_at,
   p_start,p_end,btrim(p_address),agreed,btrim(p_subject),p_body,gen_random_uuid(),p_operation_id,clock_timestamp()+interval '5 minutes') returning * into b;
 return to_jsonb(b)||jsonb_build_object('claimed',true,'newly_created',true);
end $$;
revoke all on function public.begin_website_walkthrough(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz,text,text,text,text,text,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.begin_website_walkthrough(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz,text,text,text,text,text,boolean,text,uuid) to service_role;

create or replace function public.record_website_walkthrough_event(p_id uuid,p_event_id text,p_event_url text,p_operation_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.website_walkthrough_bookings%rowtype;
begin
 if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
 if nullif(btrim(p_event_id),'') is null or coalesce(p_event_url,'') !~ '^https://(www\.)?google\.com/calendar/|^https://calendar\.google\.com/' then raise exception 'A verified calendar receipt is required'; end if;
 select * into b from public.website_walkthrough_bookings where id=p_id for update;
 if not found or b.status='failed' then raise exception 'Booking reservation unavailable'; end if;
 if b.operation_token is distinct from p_operation_id then raise exception 'A newer confirmation attempt owns this booking'; end if;
 if b.calendar_event_id is not null and b.calendar_event_id<>p_event_id then raise exception 'Different event already recorded'; end if;
 update public.website_walkthrough_bookings set calendar_event_id=p_event_id,calendar_event_url=p_event_url,
   status=case when status='confirmed' then status else 'calendar_created' end,error=null,updated_at=clock_timestamp() where id=p_id returning * into b;
 return to_jsonb(b);
end $$;
revoke all on function public.record_website_walkthrough_event(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_website_walkthrough_event(uuid,text,text,uuid) to service_role;

create or replace function public.finish_website_walkthrough(p_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.website_walkthrough_bookings%rowtype; stamp timestamptz:=clock_timestamp(); target uuid; t public.todos%rowtype;
begin
 if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
 select inquiry_id into target from public.website_walkthrough_bookings where id=p_id;
 select * into t from public.todos where id=target for update;
 select * into b from public.website_walkthrough_bookings where id=p_id for update;
 if not found then raise exception 'Booking reservation unavailable'; end if;
 if b.status='confirmed' then return to_jsonb(b); end if;
 if b.operation_token is distinct from p_operation_id then raise exception 'A newer confirmation attempt owns this booking'; end if;
 if t.status='done' or t.intake_status in ('closed','spam') then raise exception 'The invitation exists, but this inquiry was closed. Review it before changing its status.'; end if;
 if b.calendar_event_id is null or not exists(select 1 from public.website_inquiry_emails
   where id=b.confirmation_email_id and inquiry_id=b.inquiry_id and status='sent' and recipient_email=b.recipient_email
   and subject=b.subject and body=b.body and sender_profile_id=b.sender_profile_id) then raise exception 'Calendar and confirmation email must both be verified'; end if;
 update public.website_walkthrough_bookings set status='confirmed',error=null,operation_token=null,operation_until=null,updated_at=stamp where id=p_id returning * into b;
 update public.todos set intake_status='walkthrough',status='open',assignee='Ryan',due_date=b.start_at,snooze_until=null,updated_at=stamp
   where id=b.inquiry_id and source='website';
 insert into public.activity_log(user_id,action,entity_type,entity_id,details)
 values(b.sender_profile_id,'website_walkthrough_confirmed','website_inquiry',b.inquiry_id,
   jsonb_build_object('booking_id',b.id,'start',b.start_at,'calendar_event_id',b.calendar_event_id,'email_id',b.confirmation_email_id,'agreement',b.confirmation_source));
 return to_jsonb(b);
end $$;
revoke all on function public.finish_website_walkthrough(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_website_walkthrough(uuid,uuid) to service_role;

create or replace function public.mark_website_walkthrough_problem(p_id uuid,p_error text,p_definitely_not_created boolean,p_operation_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.website_walkthrough_bookings%rowtype;
begin
 if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into b from public.website_walkthrough_bookings where id=p_id for update;
 if not found then raise exception 'Booking reservation unavailable'; end if;
 if b.status<>'confirmed' and b.operation_token is distinct from p_operation_id then raise exception 'A newer confirmation attempt owns this booking'; end if;
 if b.status<>'confirmed' then
   update public.website_walkthrough_bookings set status=case when p_definitely_not_created and calendar_event_id is null then 'failed' else 'needs_attention' end,
     error=left(coalesce(p_error,'Booking needs verification'),2000),operation_token=null,operation_until=null,updated_at=clock_timestamp() where id=p_id returning * into b;
 end if;
 return to_jsonb(b);
end $$;
revoke all on function public.mark_website_walkthrough_problem(uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.mark_website_walkthrough_problem(uuid,text,boolean,uuid) to service_role;

-- Validate structured requests without changing the existing intake RPC or its deduplication.
create or replace function public.validate_website_walkthrough_request()
returns trigger language plpgsql security invoker set search_path='' as $$
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
 if tg_op='UPDATE' and new.intake_status='walkthrough' and old.intake_status is distinct from 'walkthrough'
   and not exists(select 1 from public.website_walkthrough_bookings where inquiry_id=new.id and status='confirmed') then
   raise exception 'Use Confirm and send invitation to book a walkthrough';
 end if;
 return new;
end $$;
revoke all on function public.validate_website_walkthrough_request() from public,anon,authenticated;
create trigger validate_website_walkthrough_request before insert or update on public.todos for each row execute function public.validate_website_walkthrough_request();

create or replace function public.notify_website_walkthrough_request()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.source='website' and jsonb_typeof(new.website_inquiry->'walkthrough')='object' then
   insert into public.app_notifications(recipient_profile_id,kind,title,body,url,source_type,source_id)
   select profile_id,'help','Walkthrough time requested',left(new.contact_name||' requested '||to_char(((new.website_inquiry->'walkthrough'->>'start')::timestamptz at time zone 'America/New_York'),'Mon DD at HH12:MI AM')||' ET',500),
     '/command-center/inquiries/'||new.id::text,'website_inquiry',new.id
   from public.website_inquiry_members where assignee_name='Ryan'
   on conflict(recipient_profile_id,source_type,source_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function public.notify_website_walkthrough_request() from public,anon,authenticated;
create trigger notify_website_walkthrough_request after insert on public.todos for each row execute function public.notify_website_walkthrough_request();
