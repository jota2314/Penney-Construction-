-- A sent invoice may receive an explicitly selected, approved credit. This is
-- separate from draft revision: it preserves the issued invoice and its lines,
-- appends the approved change order, and retains both records in the audit.
create unique index client_billing_audit_credit_source_idx
  on finance_internal.client_billing_audit ((after_record->'change_order'->>'id'))
  where operation = 'apply_credit';
create index client_billing_audit_credit_invoice_idx
  on finance_internal.client_billing_audit (invoice_id)
  where operation = 'apply_credit';

-- Preserve the approved source and issued invoice once a credit is audited.
-- These private definer triggers can inspect the private audit even when an
-- authenticated caller uses the ordinary change-order edit/delete workflow.
create function finance_internal.protect_applied_credit_source()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from finance_internal.client_billing_audit
    where operation = 'apply_credit' and after_record->'change_order'->>'id' = old.id::text) then
    if tg_op = 'DELETE' then
      raise exception 'An applied invoice credit cannot be deleted. Preserve its approved change order.';
    end if;
    if (new.project_id,new.price_impact,new.status,new.change_order_number,new.client_invoice_id,new.title)
      is distinct from
      (old.project_id,old.price_impact,old.status,old.change_order_number,old.client_invoice_id,old.title) then
      raise exception 'This change order is an applied invoice credit. Its approved billing details cannot be changed.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function finance_internal.protect_applied_credit_source() from public,anon,authenticated,service_role;
create trigger protect_applied_credit_source before update or delete on public.change_orders
  for each row execute function finance_internal.protect_applied_credit_source();

-- The existing change-order delete action removes estimate lines in a separate
-- request before deleting the source. Block that first request too, so a rejected
-- source deletion cannot leave its estimate line missing.
create function finance_internal.protect_applied_credit_estimate_line()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.change_order_id is not null and exists (
    select 1 from finance_internal.client_billing_audit where operation = 'apply_credit'
      and after_record->'change_order'->>'id' = old.change_order_id::text
  ) then
    raise exception 'An applied invoice credit estimate line cannot be deleted. Preserve its approved change order.';
  end if;
  return old;
end;
$$;
revoke all on function finance_internal.protect_applied_credit_estimate_line() from public,anon,authenticated,service_role;
create trigger protect_applied_credit_estimate_line before delete on public.estimate_line_items
  for each row execute function finance_internal.protect_applied_credit_estimate_line();

create function finance_internal.protect_credited_invoice()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from finance_internal.client_billing_audit
    where operation = 'apply_credit' and invoice_id = old.id) then
    raise exception 'An invoice with an applied credit cannot be deleted. Preserve its billing history.';
  end if;
  return old;
end;
$$;
revoke all on function finance_internal.protect_credited_invoice() from public,anon,authenticated,service_role;
create trigger protect_credited_invoice before delete on public.client_invoices
  for each row execute function finance_internal.protect_credited_invoice();

create function finance_internal.apply_invoice_credit(
  p_actor_id uuid, p_invoice_id uuid, p_project_id uuid,
  p_expected_updated_at timestamptz, p_change_order_id uuid,
  p_expected_change_order_updated_at timestamptz, p_reason text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_invoice public.client_invoices%rowtype;
  v_change public.change_orders%rowtype;
  v_existing finance_internal.client_billing_audit%rowtype;
  v_before jsonb;
  v_line jsonb;
  v_total numeric := 0;
  v_credit numeric;
  v_legacy_reference text;
begin
  perform finance_internal.require_actor(p_actor_id);
  if p_expected_updated_at is null or p_expected_change_order_updated_at is null
    or p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception 'Provide the current invoice and change order versions and a credit reason.';
  end if;

  -- Serialize project credit applications, then lock the selected source and
  -- invoice in that order. Receipt application also locks its invoice before
  -- changing it, so it cannot race this invoice's eligibility check.
  perform 1 from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project not found.'; end if;
  select * into v_change from public.change_orders
    where id = p_change_order_id and project_id = p_project_id for update;
  if not found then raise exception 'Change order not found in this project.'; end if;
  select * into v_invoice from public.client_invoices
    where id = p_invoice_id and project_id = p_project_id for update;
  if not found then raise exception 'Invoice not found in this project.'; end if;

  select * into v_existing from finance_internal.client_billing_audit
    where operation = 'apply_credit'
      and after_record->'change_order'->>'id' = p_change_order_id::text;
  if found then
    if v_existing.invoice_id <> p_invoice_id or v_existing.project_id <> p_project_id then
      raise exception 'This credit has already been applied to another invoice.';
    end if;
    -- A retry with the original version token is safe only when the audited
    -- application still exists. A legacy description alone is not a retry.
    if v_change.client_invoice_id is distinct from p_invoice_id
      or not (v_invoice.line_items @> jsonb_build_array(jsonb_build_object(
        'change_order_id', p_change_order_id,
        'amount', (v_existing.after_record->>'credit_amount')::numeric))) then
      raise exception 'The previously applied credit has changed. Review its billing history.';
    end if;
    return jsonb_build_object('id',v_invoice.id,'invoice_number',v_invoice.invoice_number,
      'amount',v_invoice.amount,'status',v_invoice.status,'updated_at',v_invoice.updated_at,
      'change_order_id',p_change_order_id,
      'credit_amount',(v_existing.after_record->>'credit_amount')::numeric,'already_applied',true);
  end if;

  if v_invoice.updated_at is distinct from p_expected_updated_at then
    raise exception 'Invoice changed. Read current billing before applying a credit.';
  end if;
  if v_change.updated_at is distinct from p_expected_change_order_updated_at then
    raise exception 'Change order changed. Review the current credit before applying it.';
  end if;
  if v_invoice.status is distinct from 'sent' or v_invoice.paid_at is not null
    or coalesce(v_invoice.paid_amount,0) <> 0
    or exists (select 1 from public.payments_received where client_invoice_id = p_invoice_id)
    or exists (select 1 from jsonb_each(to_jsonb(v_invoice)) f
      where (f.key like 'quickbooks\_%' escape '\' or f.key like 'qb\_%' escape '\')
        and f.value <> 'null'::jsonb) then
    raise exception 'Only an unpaid sent invoice without receipts or external accounting links can receive a credit.';
  end if;
  if v_change.status is distinct from 'approved' or v_change.price_impact is null
    or v_change.price_impact::text in ('NaN','Infinity','-Infinity')
    or v_change.price_impact >= 0 or abs(v_change.price_impact) > 100000000
    or v_change.price_impact <> round(v_change.price_impact,2)
    or v_change.title is null or length(btrim(v_change.title)) not between 1 and 3900
    or v_change.change_order_number is null or v_change.change_order_number < 1 then
    raise exception 'Choose an approved negative change order with a title and an exact dollar credit.';
  end if;
  if v_change.client_invoice_id is not null then
    raise exception 'This change order is already linked to an invoice.';
  end if;
  if exists (select 1 from public.client_invoices ci
    where ci.line_items @> jsonb_build_array(jsonb_build_object('change_order_id',p_change_order_id))) then
    raise exception 'This change order is already included in an invoice.';
  end if;
  -- Older invoices identify credits in prose. Match an explicit CO number on
  -- a negative line; never infer duplicate credits from equal amounts alone.
  v_legacy_reference := '\m(CO|change[[:space:]]+order)[[:space:]]*#?[[:space:]]*0*'
    || v_change.change_order_number::text || '\M';
  if exists (select 1 from public.client_invoices ci
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ci.line_items) = 'array' then ci.line_items else '[]'::jsonb end
    ) line
    where ci.project_id = p_project_id
      and case when jsonb_typeof(line->'amount') = 'number'
        then (line->>'amount')::numeric < 0 else false end
      and line->>'description' ~* v_legacy_reference) then
    raise exception 'This change order is already referenced by an existing invoice credit.';
  end if;

  if jsonb_typeof(v_invoice.line_items) is distinct from 'array' then
    raise exception 'Review the existing invoice lines before applying a credit.';
  end if;
  if jsonb_array_length(v_invoice.line_items) not between 1 and 199 then
    raise exception 'The invoice must have 1 to 199 existing lines before adding a credit.';
  end if;
  for v_line in select value from jsonb_array_elements(v_invoice.line_items) loop
    if jsonb_typeof(v_line) <> 'object' or jsonb_typeof(v_line->'description') is distinct from 'string'
      or length(btrim(v_line->>'description')) not between 1 and 4000
      or jsonb_typeof(v_line->'amount') is distinct from 'number' then
      raise exception 'Review the existing invoice lines before applying a credit.';
    end if;
    if abs((v_line->>'amount')::numeric) > 100000000
      or (v_line->>'amount')::numeric <> round((v_line->>'amount')::numeric,2) then
      raise exception 'Existing invoice lines must use dollar amounts with at most two decimal places.';
    end if;
    v_total := v_total + (v_line->>'amount')::numeric;
  end loop;
  if v_invoice.amount is null or v_total is distinct from v_invoice.amount then
    raise exception 'Existing invoice lines do not match its total. Review the invoice first.';
  end if;
  v_credit := v_change.price_impact;
  v_total := v_total + v_credit;
  if v_total <= 0 or v_total > 100000000 then
    raise exception 'The invoice total after credit must be positive and within limits.';
  end if;

  v_before := jsonb_build_object('invoice',to_jsonb(v_invoice),
    'change_order',to_jsonb(v_change),'credit_amount',v_credit);
  update public.client_invoices set
    line_items = line_items || jsonb_build_array(jsonb_build_object(
      'description','Credit: ' || btrim(v_change.title) || ' (Change Order #' || v_change.change_order_number || ')',
      'amount',v_credit,'change_order_id',p_change_order_id)),
    amount = v_total, updated_at = clock_timestamp()
    where id = p_invoice_id returning * into v_invoice;
  update public.change_orders set client_invoice_id = p_invoice_id, updated_at = clock_timestamp()
    where id = p_change_order_id returning * into v_change;
  insert into finance_internal.client_billing_audit(
    actor_id,project_id,invoice_id,operation,reason,before_record,after_record
  ) values (p_actor_id,p_project_id,p_invoice_id,'apply_credit',btrim(p_reason),v_before,
    jsonb_build_object('invoice',to_jsonb(v_invoice),'change_order',to_jsonb(v_change),'credit_amount',v_credit));
  return jsonb_build_object('id',v_invoice.id,'invoice_number',v_invoice.invoice_number,
    'amount',v_invoice.amount,'status',v_invoice.status,'updated_at',v_invoice.updated_at,
    'change_order_id',p_change_order_id,'credit_amount',v_credit,'already_applied',false);
end;
$$;
revoke all on function finance_internal.apply_invoice_credit(uuid,uuid,uuid,timestamptz,uuid,timestamptz,text)
  from public,anon,authenticated,service_role;

-- Match the existing app billing boundary: authenticated callers cannot choose
-- an actor. Only the wrapper may enter the private audited workflow.
create function public.apply_client_invoice_credit(
  p_invoice_id uuid, p_project_id uuid, p_expected_updated_at timestamptz,
  p_change_order_id uuid, p_expected_change_order_updated_at timestamptz, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return finance_internal.apply_invoice_credit(auth.uid(),p_invoice_id,p_project_id,
    p_expected_updated_at,p_change_order_id,p_expected_change_order_updated_at,p_reason);
end;
$$;
revoke all on function public.apply_client_invoice_credit(uuid,uuid,timestamptz,uuid,timestamptz,text)
  from public,anon,service_role;
grant execute on function public.apply_client_invoice_credit(uuid,uuid,timestamptz,uuid,timestamptz,text)
  to authenticated;
