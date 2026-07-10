-- Proposals live on the estimates table. Two gaps fixed here (already
-- applied to the live DB 2026-07-10):
--
-- 1. Estimates could never be marked "sent" or "accepted" — the check
--    constraint stopped at the internal review lifecycle, so client sends
--    and signings were never recorded.
-- 2. Project money only updated through the one in-app "approve as
--    contract" button. Contracts signed outside the app left
--    contract_value/estimated_value null and the job read as $0 in every
--    Command Center total.
--
-- The trigger keeps project money in sync with its proposal on any write
-- path (app, MCP server, manual SQL): the last approved/sent proposal is
-- the live number for the job; once a job is contracted, a re-sent or
-- accepted proposal updates the contract value too.

alter table estimates drop constraint estimates_status_check;
alter table estimates add constraint estimates_status_check
  check (status = any (array['draft'::text, 'review'::text, 'approved'::text, 'sent'::text, 'accepted'::text, 'rejected'::text, 'superseded'::text]));

create or replace function sync_project_value_from_estimate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_id is null or new.total_price is null or new.total_price <= 0 then
    return new;
  end if;

  -- Only act when the status or the money actually changed.
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.total_price is not distinct from old.total_price then
    return new;
  end if;

  if new.status = 'accepted' then
    -- Client signed: this is the contract.
    update projects set
      contract_value = new.total_price,
      estimated_value = coalesce(estimated_value, new.total_price),
      status = case when status in ('contracted','in_progress','completed') then status else 'contracted' end,
      updated_at = now()
    where id = new.project_id;

  elsif new.status = 'sent' then
    -- Latest proposal in front of the client drives the pipeline number;
    -- if the job is already under contract, a re-sent proposal re-prices it.
    update projects set
      estimated_value = new.total_price,
      contract_value = case when status in ('contracted','in_progress') then new.total_price else contract_value end,
      updated_at = now()
    where id = new.project_id;

  elsif new.status = 'approved' then
    -- Ryan-approved: the working number for the job.
    update projects set
      estimated_value = new.total_price,
      updated_at = now()
    where id = new.project_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_estimates_value_sync on estimates;
create trigger trg_estimates_value_sync
after insert or update of status, total_price on estimates
for each row execute function sync_project_value_from_estimate();
