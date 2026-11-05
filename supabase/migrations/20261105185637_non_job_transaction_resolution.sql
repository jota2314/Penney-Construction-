-- Explicit office classification of an EXISTING transaction. No backfill,
-- amounts, payments, QuickBooks links or bank cash activity are changed.
alter table public.invoices
  add column non_job_reason text check (non_job_reason in ('owner_draw','card_payment_transfer')),
  add column non_job_resolved_at timestamptz,
  add column non_job_resolved_by uuid references public.profiles(id),
  add column non_job_note text;
alter table public.invoices add constraint invoices_non_job_unallocated check (
  non_job_reason is null or (
    project_id is null and estimate_line_item_id is null and split_group_id is null
    and duplicate_of_id is null and review_status = 'ok'
    and non_job_resolved_at is not null and non_job_resolved_by is not null
  )
);
create index invoices_non_job_resolved_idx on public.invoices(non_job_resolved_at desc,id)
  where non_job_reason is not null;

-- Remote QuickBooks requests outlive a database transaction. A durable claim
-- closes the gap between reading an expense and stamping its remote ID. There
-- is deliberately no expiry: a crashed send needs reconciliation before any
-- retry or reclassification; its token remains available to diagnose/release.
create schema if not exists finance_internal;
create table finance_internal.invoice_quickbooks_push_claims (
  invoice_id uuid primary key references public.invoices(id) on delete restrict,
  claim_token uuid not null,
  claimed_at timestamptz not null default clock_timestamp()
);
create index invoice_quickbooks_push_claims_token_idx on finance_internal.invoice_quickbooks_push_claims(claim_token);
alter table finance_internal.invoice_quickbooks_push_claims enable row level security;
revoke all on finance_internal.invoice_quickbooks_push_claims from public,anon,authenticated,service_role;

create function public.invoice_has_quickbooks_push_claim(p_invoice_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()
    and role::text in ('owner','office_admin','precon_manager')) then
    raise exception 'Office access required' using errcode='42501';
  end if;
  return exists(select 1 from finance_internal.invoice_quickbooks_push_claims where invoice_id=p_invoice_id);
end $$;
revoke all on function public.invoice_has_quickbooks_push_claim(uuid) from public,anon,authenticated,service_role;
grant execute on function public.invoice_has_quickbooks_push_claim(uuid) to authenticated;

create function public.claim_invoice_quickbooks_push(p_invoice_ids uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare ids uuid[]; claimed uuid:=gen_random_uuid(); found_count integer;
begin
  select array_agg(distinct x order by x) into ids from unnest(p_invoice_ids) x where x is not null;
  if coalesce(cardinality(ids),0)=0 then raise exception 'No transactions to send'; end if;
  perform id from public.invoices where id=any(ids) order by id for update;
  get diagnostics found_count=row_count;
  if found_count<>cardinality(ids) then raise exception 'Transaction not found'; end if;
  if exists(select 1 from public.invoices where id=any(ids) and non_job_reason is not null) then
    raise exception 'Transaction was resolved as non-job. Refresh before sending to QuickBooks';
  end if;
  if exists(select 1 from finance_internal.invoice_quickbooks_push_claims where invoice_id=any(ids)) then
    raise exception 'A QuickBooks send is active or awaiting reconciliation. Review that send before retrying';
  end if;
  insert into finance_internal.invoice_quickbooks_push_claims(invoice_id,claim_token)
    select unnest(ids),claimed;
  return claimed;
end $$;
revoke all on function public.claim_invoice_quickbooks_push(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.claim_invoice_quickbooks_push(uuid[]) to service_role;

create function public.release_invoice_quickbooks_push(p_claim_token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform i.id from public.invoices i join finance_internal.invoice_quickbooks_push_claims c on c.invoice_id=i.id
    where c.claim_token=p_claim_token order by i.id for update of i;
  delete from finance_internal.invoice_quickbooks_push_claims where claim_token=p_claim_token;
end $$;
revoke all on function public.release_invoice_quickbooks_push(uuid) from public,anon,authenticated,service_role;
grant execute on function public.release_invoice_quickbooks_push(uuid) to service_role;

create table public.invoice_non_job_history (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  action text not null check (action in ('resolved','reopened')),
  reason text check (reason in ('owner_draw','card_payment_transfer')),
  note text,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  before_record jsonb not null,
  after_record jsonb not null
);
create index invoice_non_job_history_invoice_idx on public.invoice_non_job_history(invoice_id,created_at desc,id);
alter table public.invoice_non_job_history enable row level security;
revoke all on public.invoice_non_job_history from public,anon,authenticated,service_role;
grant select on public.invoice_non_job_history to authenticated;
create policy non_job_history_office_read on public.invoice_non_job_history
  for select to authenticated using (exists (
    select 1 from public.profiles where id=(select auth.uid())
    and role::text in ('owner','office_admin','precon_manager')
  ));

-- The guard applies to every write path, including imports and direct Data API
-- updates. The native RPC adds locking and stale-version validation.
create function public.guard_invoice_non_job() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  allowed text[] := array['non_job_reason','non_job_resolved_at','non_job_resolved_by','non_job_note',
    'project_id','estimate_line_item_id','review_status','review_reason',
    'help_resolved_at','help_resolved_by','updated_at'];
begin
  if tg_op='INSERT' then
    if new.non_job_reason is not null or new.non_job_resolved_at is not null or new.non_job_resolved_by is not null then
      raise exception 'Save the transaction first, then resolve it in Sort out spending' using errcode='23514';
    end if;
    -- The existing split workflow copies a reopened source row into its new
    -- children. Only the retained source owns that review history.
    new.non_job_note := null;
    return new;
  end if;
  if new.non_job_reason is distinct from old.non_job_reason then
    if auth.uid() is null or not exists (select 1 from public.profiles where id=auth.uid()
      and role::text in ('owner','office_admin','precon_manager')) then
      raise exception 'Office access required' using errcode='42501';
    end if;
    if (to_jsonb(new)-allowed) is distinct from (to_jsonb(old)-allowed) then
      raise exception 'Resolve the existing transaction without changing its financial details' using errcode='23514';
    end if;
    if public.invoice_has_quickbooks_push_claim(old.id) then
      raise exception 'A QuickBooks send is active or awaiting reconciliation. Review that send before resolving this transaction' using errcode='23514';
    end if;
    if new.non_job_reason is not null and old.non_job_reason is not null then
      raise exception 'Reopen the transaction before changing its non-job reason' using errcode='23514';
    end if;
    if old.split_group_id is not null or old.duplicate_of_id is not null or exists (
      select 1 from public.invoices where duplicate_of_id=old.id
    ) then
      raise exception 'Review the linked or split transaction before resolving it as non-job' using errcode='23514';
    end if;
    if old.project_id is not null then
      -- Serialize with append_project_finance_record's final-audit snapshot.
      perform pg_advisory_xact_lock(hashtextextended(old.project_id::text,0));
    end if;
    if old.estimate_line_item_id is not null then
      perform id from public.estimate_line_items where id=old.estimate_line_item_id for update;
    end if;
    if old.estimate_line_item_id is not null and exists (
      select 1 from public.estimate_line_items where id=old.estimate_line_item_id and is_locked
    ) then
      raise exception 'Reopen the closed budget line through job review first' using errcode='23514';
    end if;
    if old.project_id is not null and (select kind from public.project_finance_records
      where project_id=old.project_id and kind<>'forecast' order by created_at desc,id desc limit 1)='final' then
      raise exception 'Reopen the final job audit first' using errcode='23514';
    end if;
    if length(coalesce(new.non_job_note,''))>2000 then raise exception 'Note must be 2000 characters or fewer'; end if;
    new.non_job_note := nullif(btrim(new.non_job_note),'');
    new.project_id := null;
    new.estimate_line_item_id := null;
    new.updated_at := clock_timestamp();
    if new.non_job_reason is not null then
      new.non_job_resolved_at := new.updated_at;
      new.non_job_resolved_by := auth.uid();
      new.review_status := 'ok';
      new.review_reason := null;
      new.help_resolved_at := new.updated_at;
      new.help_resolved_by := auth.uid();
    else
      if new.non_job_note is null then raise exception 'Explain why this transaction is being reopened'; end if;
      new.non_job_resolved_at := null;
      new.non_job_resolved_by := null;
      new.review_status := 'needs_review';
      new.review_reason := 'Reopened non-job transaction: ' || new.non_job_note;
      new.help_resolved_at := null;
      new.help_resolved_by := null;
    end if;
  elsif old.non_job_reason is not null then
    -- A sync or old screen cannot silently turn an owner draw back into a cost,
    -- approve it for payment, alter its money, or erase classification evidence.
    if (to_jsonb(new)-array['updated_at','notes']) is distinct from (to_jsonb(old)-array['updated_at','notes']) then
      raise exception 'Reopen this non-job transaction before editing it' using errcode='23514';
    end if;
  elsif new.non_job_resolved_at is distinct from old.non_job_resolved_at
     or new.non_job_resolved_by is distinct from old.non_job_resolved_by
     or new.non_job_note is distinct from old.non_job_note then
    raise exception 'Use the non-job resolution workflow to change classification evidence' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_invoice_non_job() from public,anon,authenticated,service_role;
create trigger aaa_guard_invoice_non_job before insert or update on public.invoices
  for each row execute function public.guard_invoice_non_job();

-- Only this trigger may append immutable history. Definer privilege is needed
-- solely for insertion into the audit table, which callers cannot mutate.
create schema if not exists finance_internal;
create function finance_internal.reject_invoice_non_job_history_mutation() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  raise exception 'Non-job transaction history is immutable' using errcode='23514';
end $$;
revoke all on function finance_internal.reject_invoice_non_job_history_mutation() from public,anon,authenticated,service_role;
create trigger immutable_invoice_non_job_history before update or delete on public.invoice_non_job_history
  for each row execute function finance_internal.reject_invoice_non_job_history_mutation();
create function finance_internal.audit_invoice_non_job() returns trigger
language plpgsql security definer set search_path = pg_catalog,public as $$
begin
  if new.non_job_reason is distinct from old.non_job_reason then
    if auth.uid() is null then raise exception 'Authenticated actor required' using errcode='42501'; end if;
    insert into public.invoice_non_job_history(invoice_id,action,reason,note,actor_id,before_record,after_record)
    values(new.id,case when new.non_job_reason is null then 'reopened' else 'resolved' end,
      coalesce(new.non_job_reason,old.non_job_reason),new.non_job_note,auth.uid(),to_jsonb(old),to_jsonb(new));
  end if;
  return new;
end $$;
revoke all on function finance_internal.audit_invoice_non_job() from public,anon,authenticated,service_role;
create trigger audit_invoice_non_job after update on public.invoices
  for each row execute function finance_internal.audit_invoice_non_job();

-- Ordinary expenses retain the existing job + budget-line confirmation rule.
create or replace function public.guard_new_spend_confirmation()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.non_job_reason is null and new.review_status='ok'
     and (old.review_status is distinct from new.review_status
       or new.help_resolved_at is distinct from old.help_resolved_at
       or new.help_resolved_by is distinct from old.help_resolved_by)
     and (new.project_id is null or new.estimate_line_item_id is null) then
    raise exception 'Choose a job and budget line before confirming' using errcode='23514';
  end if;
  return new;
end $$;

create function public.resolve_non_job_transaction(p_invoice_id uuid,p_reason text,p_note text,p_expected_updated_at timestamptz)
returns void language plpgsql security invoker set search_path=public as $$
declare r public.invoices%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()
    and role::text in ('owner','office_admin','precon_manager')) then
    raise exception 'Office access required' using errcode='42501';
  end if;
  if p_reason is null or p_reason not in ('owner_draw','card_payment_transfer') then raise exception 'Choose a non-job reason'; end if;
  select * into r from public.invoices where id=p_invoice_id for update;
  if not found then raise exception 'Transaction not found'; end if;
  if p_expected_updated_at is null or r.updated_at is distinct from p_expected_updated_at then
    raise exception 'Transaction changed. Refresh and review it again' using errcode='40001';
  end if;
  if r.non_job_reason is not null then raise exception 'Transaction is already resolved as non-job'; end if;
  update public.invoices set non_job_reason=p_reason,non_job_note=p_note where id=r.id;
end $$;
revoke all on function public.resolve_non_job_transaction(uuid,text,text,timestamptz) from public,anon,service_role;
grant execute on function public.resolve_non_job_transaction(uuid,text,text,timestamptz) to authenticated;

create function public.reopen_non_job_transaction(p_invoice_id uuid,p_note text,p_expected_updated_at timestamptz)
returns void language plpgsql security invoker set search_path=public as $$
declare r public.invoices%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()
    and role::text in ('owner','office_admin','precon_manager')) then
    raise exception 'Office access required' using errcode='42501';
  end if;
  select * into r from public.invoices where id=p_invoice_id for update;
  if not found then raise exception 'Transaction not found'; end if;
  if p_expected_updated_at is null or r.updated_at is distinct from p_expected_updated_at then
    raise exception 'Transaction changed. Refresh and review it again' using errcode='40001';
  end if;
  if r.non_job_reason is null then raise exception 'Transaction is not resolved as non-job'; end if;
  update public.invoices set non_job_reason=null,non_job_note=p_note where id=r.id;
end $$;
revoke all on function public.reopen_non_job_transaction(uuid,text,timestamptz) from public,anon,service_role;
grant execute on function public.reopen_non_job_transaction(uuid,text,timestamptz) to authenticated;
