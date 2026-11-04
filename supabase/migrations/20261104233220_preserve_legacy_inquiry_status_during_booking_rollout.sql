-- Keep pre-calendar inquiries compatible with the still-live manual status UI.
-- New structured website visit requests require a real confirmed appointment.
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
 if tg_op='UPDATE' and jsonb_typeof(r)='object' and new.intake_status='walkthrough' and old.intake_status is distinct from 'walkthrough'
   and not exists(select 1 from public.website_walkthrough_bookings where inquiry_id=new.id and status='confirmed') then
   raise exception 'Use Confirm and send invitation to book a walkthrough';
 end if;
 return new;
end $$;
revoke all on function public.validate_website_walkthrough_request() from public,anon,authenticated;
