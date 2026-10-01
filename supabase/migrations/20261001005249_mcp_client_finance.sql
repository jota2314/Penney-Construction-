-- Shared app/MCP workflows. MCP wrappers are service-only and resolve a
-- verified caller; authenticated users cannot supply another actor identity.
create schema if not exists finance_internal;
revoke all on schema finance_internal from public, anon, authenticated, service_role;

create table finance_internal.client_billing_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  project_id uuid not null,
  invoice_id uuid not null,
  receipt_id uuid,
  operation text not null,
  reason text not null,
  before_record jsonb not null,
  after_record jsonb not null,
  created_at timestamptz not null default now()
);
alter table finance_internal.client_billing_audit enable row level security;
revoke all on finance_internal.client_billing_audit from public, anon, authenticated, service_role;

create function finance_internal.require_actor(p_actor_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_actor_id is null or not exists (
    select 1 from public.profiles where id=p_actor_id and role in ('owner','office_admin','precon_manager')
  ) then raise exception 'You do not have access to client billing.'; end if;
end;
$$;

create function finance_internal.revise_invoice(
  p_actor_id uuid, p_invoice_id uuid, p_project_id uuid, p_expected_updated_at timestamptz,
  p_title text, p_terms text, p_line_items jsonb, p_reason text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_invoice public.client_invoices%rowtype;
  v_before jsonb;
  v_amount numeric := 0;
  v_line jsonb;
begin
  perform finance_internal.require_actor(p_actor_id);
  if p_title is null or length(btrim(p_title)) not between 1 and 500
    or p_reason is null or length(btrim(p_reason)) not between 1 and 2000
    or p_terms is null or length(p_terms)>2000 or p_expected_updated_at is null then
    raise exception 'Provide a title, terms, reason and current invoice version.';
  end if;
  if p_line_items is null or jsonb_typeof(p_line_items)<>'array' then raise exception 'Provide invoice lines.'; end if;
  if jsonb_array_length(p_line_items) not between 1 and 200 then raise exception 'Provide 1 to 200 lines.'; end if;
  for v_line in select value from jsonb_array_elements(p_line_items) loop
    if jsonb_typeof(v_line)<>'object' or jsonb_typeof(v_line->'description') is distinct from 'string'
      or length(btrim(v_line->>'description')) not between 1 and 4000
      or jsonb_typeof(v_line->'amount') is distinct from 'number' then raise exception 'Invalid invoice line.'; end if;
    if abs((v_line->>'amount')::numeric)>100000000
      or (v_line->>'amount')::numeric <> round((v_line->>'amount')::numeric,2) then
      raise exception 'Use dollar amounts with at most two decimal places.';
    end if;
    v_amount := v_amount + (v_line->>'amount')::numeric;
  end loop;
  if v_amount<=0 or v_amount>100000000 then raise exception 'Invoice total must be positive and within limits.'; end if;
  select * into v_invoice from public.client_invoices where id=p_invoice_id and project_id=p_project_id for update;
  if not found then raise exception 'Invoice not found in this project.'; end if;
  if v_invoice.updated_at is distinct from p_expected_updated_at then raise exception 'Invoice changed. Read current billing before editing.'; end if;
  if v_invoice.status is distinct from 'draft' or v_invoice.sent_to_client_at is not null
    or v_invoice.paid_at is not null or coalesce(v_invoice.paid_amount,0)<>0
    or v_invoice.quickbooks_invoice_id is not null or v_invoice.quickbooks_id is not null
    or v_invoice.quickbooks_doc_number is not null
    or exists(select 1 from public.payments_received where client_invoice_id=p_invoice_id) then
    raise exception 'Only an unpaid, unsent draft without receipts or external accounting links can be revised.';
  end if;
  v_before := jsonb_build_object('title',v_invoice.title,'line_items',v_invoice.line_items,
    'amount',v_invoice.amount,'terms',v_invoice.terms,'updated_at',v_invoice.updated_at);
  update public.client_invoices set title=btrim(p_title),terms=p_terms,line_items=p_line_items,
    amount=v_amount,updated_at=clock_timestamp() where id=p_invoice_id returning * into v_invoice;
  insert into finance_internal.client_billing_audit(actor_id,project_id,invoice_id,operation,reason,before_record,after_record)
    values(p_actor_id,p_project_id,p_invoice_id,'revise_draft',p_reason,v_before,
      jsonb_build_object('title',v_invoice.title,'line_items',v_invoice.line_items,'amount',v_invoice.amount,
        'terms',v_invoice.terms,'updated_at',v_invoice.updated_at));
  -- Preserve signed milestone/contract amounts; this revises billing only.
  return jsonb_build_object('id',v_invoice.id,'invoice_number',v_invoice.invoice_number,
    'amount',v_invoice.amount,'status',v_invoice.status,'updated_at',v_invoice.updated_at);
end;
$$;

create function public.revise_client_invoice(
  p_invoice_id uuid,p_project_id uuid,p_expected_updated_at timestamptz,
  p_title text,p_terms text,p_line_items jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return finance_internal.revise_invoice(auth.uid(),p_invoice_id,p_project_id,p_expected_updated_at,p_title,p_terms,p_line_items,p_reason);
end;
$$;
revoke all on function public.revise_client_invoice(uuid,uuid,timestamptz,text,text,jsonb,text) from public,anon,service_role;
grant execute on function public.revise_client_invoice(uuid,uuid,timestamptz,text,text,jsonb,text) to authenticated;

create function public.mcp_revise_client_invoice(
  p_actor_id uuid,p_invoice_id uuid,p_project_id uuid,p_expected_updated_at timestamptz,
  p_title text,p_terms text,p_line_items jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted MCP service required.'; end if;
  return finance_internal.revise_invoice(p_actor_id,p_invoice_id,p_project_id,p_expected_updated_at,p_title,p_terms,p_line_items,p_reason);
end;
$$;
revoke all on function public.mcp_revise_client_invoice(uuid,uuid,uuid,timestamptz,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.mcp_revise_client_invoice(uuid,uuid,uuid,timestamptz,text,text,jsonb,text) to service_role;

create function public.mcp_get_client_billing(p_actor_id uuid,p_project_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_project jsonb; v_contract numeric; v_changes numeric; v_received numeric;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted MCP service required.'; end if;
  perform finance_internal.require_actor(p_actor_id);
  select jsonb_build_object('id',id,'name',name,'project_number',project_number,'contract_status',contract_status,
    'contract_locked_amount',contract_locked_amount,'contract_value',contract_value),
    coalesce(contract_locked_amount,contract_value) into v_project,v_contract from public.projects where id=p_project_id;
  if not found then raise exception 'Project not found.'; end if;
  select coalesce(sum(price_impact),0) into v_changes from public.change_orders where project_id=p_project_id and status='approved';
  select coalesce(sum(amount),0) into v_received from public.payments_received where project_id=p_project_id;
  return jsonb_build_object('project',v_project,'contract_plus_approved_changes',v_contract+v_changes,
    'recorded_received',v_received,'contract_less_recorded_receipts',v_contract+v_changes-v_received,
    'invoices',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'invoice_number',invoice_number,'title',title,
      'line_items',line_items,'amount',amount,'terms',terms,'status',status,'paid_amount',paid_amount,
      'paid_at',paid_at,'due_date',due_date,'sent_to_client_at',sent_to_client_at,'updated_at',updated_at,
      'has_external_accounting_link',quickbooks_invoice_id is not null or quickbooks_id is not null or quickbooks_doc_number is not null)
      order by invoice_number),'[]'::jsonb) from public.client_invoices where project_id=p_project_id),
    'receipts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'amount',amount,'received_date',received_date,
      'reference_number',reference_number,'description',description,'review_status',review_status,'client_invoice_id',client_invoice_id)
      order by received_date,id),'[]'::jsonb) from public.payments_received where project_id=p_project_id),
    'history',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from finance_internal.client_billing_audit a where project_id=p_project_id),
    'note','Recorded receipts are not bank-clearing evidence. Draft invoices are not overdue collections.');
end;
$$;
revoke all on function public.mcp_get_client_billing(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mcp_get_client_billing(uuid,uuid) to service_role;

revoke all on all functions in schema finance_internal from public,anon,authenticated,service_role;
create or replace function finance_internal.apply_receipt(p_actor_id uuid, p_invoice_id uuid, p_project_id uuid, p_receipt_id uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_invoice client_invoices%rowtype;
  v_receipt payments_received%rowtype;
  v_total numeric;
  v_paid_at timestamptz;
begin
  if p_actor_id is null or not exists(select 1 from profiles where id=p_actor_id and role in ('owner','office_admin','precon_manager')) then
    raise exception 'You do not have access to apply payments.';
  end if;
  select * into v_invoice from client_invoices where id=p_invoice_id and project_id=p_project_id for update;
  if not found then raise exception 'Invoice not found in this project.'; end if;
  if v_invoice.status not in ('sent','paid') or v_invoice.amount <= 0 then
    raise exception 'Only a sent invoice can receive a payment.';
  end if;
  select * into v_receipt from payments_received where id=p_receipt_id for update;
  if not found or v_receipt.project_id is distinct from p_project_id or v_receipt.amount <= 0 then
    raise exception 'Choose a positive receipt from this project.';
  end if;
  if v_receipt.client_invoice_id is not null and v_receipt.client_invoice_id <> p_invoice_id then
    raise exception 'This receipt is already applied to another invoice.';
  end if;
  if v_receipt.review_status is distinct from 'ok' then
    raise exception 'Review this receipt before applying it.';
  end if;
  if v_receipt.client_invoice_id = p_invoice_id then
    return jsonb_build_object('already_applied',true,'paid_amount',v_invoice.paid_amount,'status',v_invoice.status);
  end if;
  -- Locking both rows serializes invoice totals and prevents cross-invoice reuse.
  update payments_received set client_invoice_id=p_invoice_id, updated_at=now() where id=p_receipt_id;
  if exists(select 1 from payments_received where client_invoice_id=p_invoice_id and project_id is distinct from p_project_id) then
    raise exception 'An existing receipt belongs to another project. Review the allocations.';
  end if;
  select coalesce(sum(amount),0),max(received_date)::timestamptz into v_total,v_paid_at
    from payments_received where client_invoice_id=p_invoice_id;
  if v_total > v_invoice.amount then raise exception 'Receipts exceed the invoice balance. Review or split the receipt first.'; end if;
  update client_invoices set paid_amount=v_total,
    status=case when v_total=amount then 'paid' else 'sent' end,
    paid_at=case when v_total=amount then v_paid_at else null end,updated_at=now()
    where id=p_invoice_id;
  update project_payment_milestones set status=case when v_total=v_invoice.amount then 'paid' else 'invoiced' end,
    updated_at=now() where client_invoice_id=p_invoice_id and project_id=p_project_id;
  insert into finance_internal.client_billing_audit(actor_id,project_id,invoice_id,receipt_id,operation,reason,before_record,after_record)
  values(p_actor_id,p_project_id,p_invoice_id,p_receipt_id,'apply_receipt','Explicitly selected existing receipt',
    jsonb_build_object('status',v_invoice.status,'paid_amount',v_invoice.paid_amount,'receipt_invoice_id',v_receipt.client_invoice_id),
    jsonb_build_object('paid_amount',v_total,'receipt_invoice_id',p_invoice_id));
  return jsonb_build_object('paid_amount',v_total,'status',case when v_total=v_invoice.amount then 'paid' else 'sent' end);
end;
$$;

create or replace function public.apply_client_invoice_receipt(p_invoice_id uuid,p_project_id uuid,p_receipt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return finance_internal.apply_receipt(auth.uid(),p_invoice_id,p_project_id,p_receipt_id);
end;
$$;
revoke all on function public.apply_client_invoice_receipt(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.apply_client_invoice_receipt(uuid,uuid,uuid) to authenticated;

create function public.mcp_apply_client_receipt(p_actor_id uuid,p_invoice_id uuid,p_project_id uuid,p_receipt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted MCP service required.'; end if;
  return finance_internal.apply_receipt(p_actor_id,p_invoice_id,p_project_id,p_receipt_id);
end;
$$;
revoke all on function public.mcp_apply_client_receipt(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.mcp_apply_client_receipt(uuid,uuid,uuid,uuid) to service_role;
revoke all on all functions in schema finance_internal from public,anon,authenticated,service_role;
