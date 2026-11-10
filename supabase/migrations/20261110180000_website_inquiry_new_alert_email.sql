-- Jorge 2026-11-10: every new website inquiry emails Jorge, Ryan and Shannon.
-- One row per inquiry records the alert, so each inquiry is emailed once.
-- The inquiry itself is never updated here: its updated_at stays the
-- version the office edits against.
create table public.website_inquiry_alerts (
  inquiry_id uuid primary key references public.todos(id) on delete cascade,
  status text not null default 'sending' check (status in ('sending','sent','failed','skipped')),
  attempts integer not null default 1,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  recipients text[],
  error text
);
alter table public.website_inquiry_alerts enable row level security;
revoke all on table public.website_inquiry_alerts from public, anon, authenticated;
grant all on table public.website_inquiry_alerts to service_role;

-- Inquiries already in the app were seen before this alert existed.
insert into public.website_inquiry_alerts(inquiry_id, status, attempts, claimed_at)
select id, 'skipped', 0, now() from public.todos where source = 'website'
on conflict (inquiry_id) do nothing;

-- Claims new inquiries (last 3 days, never alerted) and retries failed ones.
-- An attempt that never reported back is retried after 10 minutes: a rare
-- duplicate alert is better than a missed lead.
create or replace function public.claim_website_inquiry_alerts(p_limit integer default 10)
returns setof uuid language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('service_role','postgres') then raise exception 'Not authorized' using errcode='42501'; end if;
  return query
  with retried as (
    update public.website_inquiry_alerts a
       set status = 'sending', attempts = a.attempts + 1, claimed_at = now(), error = null
     where a.inquiry_id in (
       select r.inquiry_id from public.website_inquiry_alerts r
        where (r.status = 'failed' and r.attempts < 5 and r.claimed_at < now() - interval '5 minutes')
           or (r.status = 'sending' and r.attempts < 3 and r.claimed_at < now() - interval '10 minutes')
        order by r.claimed_at
        limit greatest(p_limit, 1)
        for update skip locked)
    returning a.inquiry_id)
  select retried.inquiry_id from retried;
  return query
  with claimed as (
    insert into public.website_inquiry_alerts(inquiry_id)
    select t.id from public.todos t
     where t.source = 'website' and t.created_at > now() - interval '3 days'
       and not exists (select 1 from public.website_inquiry_alerts x where x.inquiry_id = t.id)
     order by t.created_at
     limit greatest(p_limit, 1)
    on conflict (inquiry_id) do nothing
    returning website_inquiry_alerts.inquiry_id)
  select claimed.inquiry_id from claimed;
end $$;
revoke all on function public.claim_website_inquiry_alerts(integer) from public, anon, authenticated;
grant execute on function public.claim_website_inquiry_alerts(integer) to service_role;
