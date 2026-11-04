-- Limit public website calendar reads before any Google requests.
create table public.website_calendar_rate_limits (
 request_key text not null, window_start timestamptz not null, requests integer not null default 1,
 primary key(request_key,window_start)
);
create index website_calendar_rate_expiry_idx on public.website_calendar_rate_limits(window_start);
alter table public.website_calendar_rate_limits enable row level security;
revoke all on table public.website_calendar_rate_limits from public,anon,authenticated;
grant all on table public.website_calendar_rate_limits to service_role;
create or replace function public.allow_website_calendar_request(p_key text,p_limit integer default 60)
returns boolean language plpgsql security invoker set search_path='' as $$
declare bucket timestamptz:=date_trunc('minute',clock_timestamp()); amount integer;
begin
 if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_limit is null or p_limit not between 1 and 60 then raise exception 'Invalid rate limit key'; end if;
 delete from public.website_calendar_rate_limits where window_start<bucket-interval '1 hour';
 insert into public.website_calendar_rate_limits(request_key,window_start) values('global',bucket)
 on conflict(request_key,window_start) do update set requests=website_calendar_rate_limits.requests+1 returning requests into amount;
 if amount>600 then return false; end if;
 insert into public.website_calendar_rate_limits(request_key,window_start) values(p_key,bucket)
 on conflict(request_key,window_start) do update set requests=website_calendar_rate_limits.requests+1 returning requests into amount;
 return amount<=p_limit;
end $$;
revoke all on function public.allow_website_calendar_request(text,integer) from public,anon,authenticated;
grant execute on function public.allow_website_calendar_request(text,integer) to service_role;

alter table public.website_walkthrough_bookings add column cancel_requested_at timestamptz,
 add column cancelled_at timestamptz, add column cancelled_by uuid references public.profiles(id);
create index website_walkthrough_cancelled_by_idx on public.website_walkthrough_bookings(cancelled_by);
alter table public.website_walkthrough_bookings drop constraint website_walkthrough_bookings_status_check;
alter table public.website_walkthrough_bookings add constraint website_walkthrough_bookings_status_check
 check(status in ('confirming','calendar_created','confirmed','needs_attention','failed','cancelling','cancelled'));
drop index public.website_walkthrough_active_inquiry_idx;
create unique index website_walkthrough_active_inquiry_idx on public.website_walkthrough_bookings(inquiry_id) where status not in ('failed','cancelled');
drop index public.website_walkthrough_availability_idx;
create index website_walkthrough_availability_idx on public.website_walkthrough_bookings(start_at,end_at) where status not in ('failed','cancelled');

create or replace function public.begin_cancel_website_walkthrough(p_id uuid,p_actor uuid,p_operation_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.website_walkthrough_bookings%rowtype; target uuid;
begin
 if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_operation_id is null or not exists(select 1 from public.website_inquiry_members where profile_id=p_actor) then raise exception 'Website inquiry access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('website-walkthrough:ryan',0));
 select inquiry_id into target from public.website_walkthrough_bookings where id=p_id;
 perform 1 from public.todos where id=target for update;
 select * into b from public.website_walkthrough_bookings where id=p_id for update;
 if not found or b.status='failed' then raise exception 'No active walkthrough to cancel'; end if;
 if b.status='cancelled' or b.operation_until>clock_timestamp() then return to_jsonb(b)||jsonb_build_object('claimed',false); end if;
 update public.website_walkthrough_bookings set status='cancelling',cancel_requested_at=coalesce(cancel_requested_at,clock_timestamp()),
   cancelled_by=p_actor,operation_token=p_operation_id,operation_until=clock_timestamp()+interval '5 minutes',error=null,updated_at=clock_timestamp()
   where id=p_id returning * into b;
 return to_jsonb(b)||jsonb_build_object('claimed',true);
end $$;
revoke all on function public.begin_cancel_website_walkthrough(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_cancel_website_walkthrough(uuid,uuid,uuid) to service_role;

create or replace function public.finish_cancel_website_walkthrough(p_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.website_walkthrough_bookings%rowtype; target uuid; stamp timestamptz:=clock_timestamp();
begin
 if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
 select inquiry_id into target from public.website_walkthrough_bookings where id=p_id;
 perform 1 from public.todos where id=target for update;
 select * into b from public.website_walkthrough_bookings where id=p_id for update;
 if not found then raise exception 'Booking not found'; end if;
 if b.status='cancelled' then return to_jsonb(b); end if;
 if b.operation_token is distinct from p_operation_id or b.cancel_requested_at is null then raise exception 'Cancellation is not owned by this operation'; end if;
 update public.website_walkthrough_bookings set status='cancelled',cancelled_at=stamp,error=null,operation_token=null,operation_until=null,updated_at=stamp
   where id=p_id returning * into b;
 update public.todos set intake_status='contacted',due_date=public.website_followup_due(stamp),updated_at=stamp
   where id=b.inquiry_id and intake_status='walkthrough' and status<>'done';
 insert into public.activity_log(user_id,action,entity_type,entity_id,details)
 values(b.cancelled_by,'website_walkthrough_cancelled','website_inquiry',b.inquiry_id,
   jsonb_build_object('booking_id',b.id,'calendar_event_id',b.calendar_event_id));
 return to_jsonb(b);
end $$;
revoke all on function public.finish_cancel_website_walkthrough(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_cancel_website_walkthrough(uuid,uuid) to service_role;

-- Updated booking lifecycle functions.
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
   if b.cancel_requested_at is not null then raise exception 'Cancellation is in progress or complete. Finish it before arranging another visit.'; end if;
   if b.status='failed' then raise exception 'This attempt did not create an appointment. Review a new booking request.'; end if;
   if b.status='confirmed' or b.operation_until>clock_timestamp() then return to_jsonb(b)||jsonb_build_object('claimed',false,'newly_created',false); end if;
   update public.website_walkthrough_bookings set operation_token=p_operation_id,operation_until=clock_timestamp()+interval '5 minutes'
     where id=p_id returning * into b;
   return to_jsonb(b)||jsonb_build_object('claimed',true,'newly_created',false);
 end if;
 if t.updated_at is distinct from p_expected_updated_at then raise exception 'This inquiry changed. Refresh before confirming.'; end if;
 if t.status='done' or t.intake_status in ('closed','spam') then raise exception 'Reopen this inquiry before scheduling'; end if;
 if lower(btrim(coalesce(nullif(t.website_inquiry->>'email',''),substring(t.description from 'Email: ([^\n\r]+)')))) is distinct from lower(btrim(p_recipient)) then raise exception 'The homeowner email changed. Refresh before confirming.'; end if;
 if p_start<now()+interval '1 hour' or (p_start at time zone 'America/New_York')::date>((now() at time zone 'America/New_York')::date+60) then raise exception 'Choose a future walkthrough within 60 days'; end if;
 if exists(select 1 from public.website_walkthrough_bookings where inquiry_id=p_inquiry_id and status not in ('failed','cancelled')) then raise exception 'This inquiry already has a booking. Open its saved confirmation.'; end if;
 if exists(select 1 from public.website_walkthrough_bookings where status not in ('failed','cancelled')
   and start_at<p_end+interval '30 minutes' and end_at>p_start-interval '30 minutes') then raise exception 'Ryan has another walkthrough at this time. Choose another opening.'; end if;
 if exists(select 1 from public.website_inquiry_emails where inquiry_id=p_inquiry_id and status in ('sending','uncertain')) then raise exception 'An email needs verification before a walkthrough can be confirmed'; end if;
 r:=t.website_inquiry->'walkthrough';
 if not exists(select 1 from public.website_walkthrough_bookings where inquiry_id=p_inquiry_id and status='cancelled') and r is not null and (r->>'start')::timestamptz=p_start and (r->>'end')::timestamptz=p_end then
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

create or replace function public.mark_website_walkthrough_problem(p_id uuid,p_error text,p_definitely_not_created boolean,p_operation_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.website_walkthrough_bookings%rowtype;
begin
 if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into b from public.website_walkthrough_bookings where id=p_id for update;
 if not found then raise exception 'Booking reservation unavailable'; end if;
 if b.status<>'confirmed' and b.operation_token is distinct from p_operation_id then raise exception 'A newer confirmation attempt owns this booking'; end if;
 if b.status<>'confirmed' then
   update public.website_walkthrough_bookings set status=case when cancel_requested_at is not null then 'cancelling' when p_definitely_not_created and calendar_event_id is null then 'failed' else 'needs_attention' end,
     error=left(coalesce(p_error,'Booking needs verification'),2000),operation_token=null,operation_until=null,updated_at=clock_timestamp() where id=p_id returning * into b;
 end if;
 return to_jsonb(b);
end $$;
revoke all on function public.mark_website_walkthrough_problem(uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.mark_website_walkthrough_problem(uuid,text,boolean,uuid) to service_role;

-- Validate structured requests without changing the existing intake RPC or its deduplication.
