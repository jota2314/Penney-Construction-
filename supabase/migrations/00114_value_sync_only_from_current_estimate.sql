-- Applied live 2026-07-29.
--
-- Only the project's CURRENT estimate may move the project's money.
--
-- sync_project_value_from_estimate() previously wrote
-- `estimated_value = new.total_price` for ANY estimate whose total or status
-- changed, with no check that the estimate was the current one. On a project
-- with several versions, touching an old version silently overwrote the value
-- the current version had set. Found in production:
--
--   Weidlein     (PC-2026-097, in_progress)   showed v1 $18,400  under a v2 of $33,248
--   Hearoutunine (PC-2026-173, proposal_sent) showed v2 $96,429  under a v3 of $136,359
--   Finkelstein  (PC-2026-164, estimating)    showed v1 $66,703  under a v2 of $108,960
--
-- The first two were repaired in the same session. Finkelstein was left alone:
-- its current v2 is a draft, and drafts are deliberately never allowed to move
-- project money (a draft is edited constantly). It self-corrects the moment v2
-- is approved or sent.
--
-- "Current" here matches src/lib/estimates/current-estimate.ts exactly: highest
-- version that is not rejected/superseded, created_at breaking ties. Keep the
-- two definitions in step.

create or replace function sync_project_value_from_estimate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked boolean;
  v_is_current boolean;
begin
  if new.project_id is null or new.total_price is null or new.total_price <= 0 then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.total_price is not distinct from old.total_price then
    return new;
  end if;

  -- A dead version never moves project money.
  if new.status in ('rejected', 'superseded') then
    return new;
  end if;

  -- Neither does a superseded one: bail unless this row IS the current estimate.
  select not exists (
    select 1 from estimates e
    where e.project_id = new.project_id
      and e.id <> new.id
      and e.status not in ('rejected', 'superseded')
      and (e.version > new.version
           or (e.version = new.version and e.created_at > new.created_at))
  ) into v_is_current;

  if not v_is_current then
    return new;
  end if;

  select contract_locked_at is not null into v_locked from projects where id = new.project_id;

  if new.status = 'accepted' then
    update projects set
      contract_value = case when v_locked then contract_value else new.total_price end,
      estimated_value = coalesce(estimated_value, new.total_price),
      status = case when status in ('contracted','in_progress','completed') then status else 'contracted' end,
      updated_at = now()
    where id = new.project_id;

  elsif new.status = 'sent' then
    update projects set
      estimated_value = new.total_price,
      contract_value = case
        when v_locked then contract_value
        when status in ('contracted','in_progress') then new.total_price
        else contract_value end,
      updated_at = now()
    where id = new.project_id;

  elsif new.status = 'approved' then
    update projects set
      estimated_value = new.total_price,
      updated_at = now()
    where id = new.project_id;
  end if;

  return new;
end;
$$;
