-- Contract e-signing + a contract value that stops moving.
--
-- Two problems this closes:
--
-- 1. Nothing froze the contract price. projects.contract_value is written by
--    the estimate-sync trigger (00095) on every send/accept, and
--    /api/generate-contract sums the visible estimate lines LIVE at render
--    time. Edit a line item after the contract went out and the PDF the
--    client holds, the tile, and the DB all disagree. Once both parties
--    sign, the price is the price — changes go through a change order.
--
-- 2. There was no signing flow at all. Change orders have had a token link +
--    public /approve/[token] page since 00050; contracts were a PDF you
--    printed. Same pattern here, plus the countersign step COs never got.
--
-- Lifecycle: draft -> sent -> viewed -> client_signed -> signed
--            (signed = both parties; that is the moment the money locks)

-- ── Public link + client tracking (mirrors change_orders) ──────────────────
alter table projects add column if not exists contract_token uuid default gen_random_uuid();
alter table projects add column if not exists contract_status text;
alter table projects add column if not exists contract_sent_to_client_at timestamptz;
alter table projects add column if not exists contract_client_email text;
alter table projects add column if not exists contract_client_viewed_at timestamptz;
alter table projects add column if not exists contract_client_view_count integer default 0;

-- ── Client signature ──────────────────────────────────────────────────────
alter table projects add column if not exists contract_client_signature text;
alter table projects add column if not exists contract_client_signed_at timestamptz;
alter table projects add column if not exists contract_client_ip text;

-- ── Penney countersignature (Ryan) ────────────────────────────────────────
alter table projects add column if not exists contract_countersigned_by uuid references auth.users(id);
alter table projects add column if not exists contract_countersigned_name text;
alter table projects add column if not exists contract_countersigned_signature text;
alter table projects add column if not exists contract_countersigned_at timestamptz;

-- ── The lock ──────────────────────────────────────────────────────────────
-- contract_locked_amount is the frozen price. contract_locked_at being set is
-- what makes the 00095 trigger keep its hands off contract_value.
alter table projects add column if not exists contract_locked_amount numeric(12,2);
alter table projects add column if not exists contract_locked_at timestamptz;
alter table projects add column if not exists contract_signed_pdf_path text;

alter table projects drop constraint if exists projects_contract_status_check;
alter table projects add constraint projects_contract_status_check
  check (contract_status is null or contract_status = any (array[
    'draft'::text, 'sent'::text, 'viewed'::text, 'client_signed'::text, 'signed'::text, 'void'::text
  ]));

-- change_orders never got one of these, so two projects could in principle
-- collide on a token. Backfill any nulls first, then enforce.
update projects set contract_token = gen_random_uuid() where contract_token is null;
alter table projects alter column contract_token set not null;
alter table projects alter column contract_token set default gen_random_uuid();
create unique index if not exists projects_contract_token_key on projects (contract_token);

-- ── Milestones: 'scheduled' = a draft invoice exists but has not been sent ──
-- Signing premakes one client invoice per milestone. Those are drafts sitting
-- in the Invoices tile ready to send, NOT money the client owes yet, so they
-- need a status distinct from 'invoiced'.
alter table project_payment_milestones drop constraint if exists project_payment_milestones_status_check;
alter table project_payment_milestones add constraint project_payment_milestones_status_check
  check (status = any (array['pending'::text, 'scheduled'::text, 'invoiced'::text, 'paid'::text]));

-- ── Teach the estimate-sync trigger to respect the lock ───────────────────
-- Identical to 00095 except contract_value is left alone once the contract is
-- locked. estimated_value still tracks the estimate — that is the pipeline
-- number, not the contracted price.
create or replace function sync_project_value_from_estimate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked boolean;
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

  select contract_locked_at is not null into v_locked from projects where id = new.project_id;

  if new.status = 'accepted' then
    -- Client signed: this is the contract.
    update projects set
      contract_value = case when v_locked then contract_value else new.total_price end,
      estimated_value = coalesce(estimated_value, new.total_price),
      status = case when status in ('contracted','in_progress','completed') then status else 'contracted' end,
      updated_at = now()
    where id = new.project_id;

  elsif new.status = 'sent' then
    -- Latest proposal in front of the client drives the pipeline number;
    -- if the job is already under contract, a re-sent proposal re-prices it.
    update projects set
      estimated_value = new.total_price,
      contract_value = case
        when v_locked then contract_value
        when status in ('contracted','in_progress') then new.total_price
        else contract_value end,
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

comment on column projects.contract_locked_amount is
  'Contract price frozen at countersignature. Once contract_locked_at is set, the estimate-sync trigger stops touching contract_value — repricing goes through a change order.';
