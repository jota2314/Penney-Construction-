-- Correct a wrong client invoice under its own number instead of voiding and
-- reissuing it (Jorge, 11/3/26). An unpaid invoice without applied receipts can
-- be revised whether it is a draft or already sent, and whether or not it has a
-- QuickBooks copy. Number, invoice_date and status never change here.
--
-- QuickBooks is never called (push stays manual). When a QuickBooks-linked
-- invoice is revised, quickbooks_out_of_date_at records it so the invoice card
-- can flag the stale copy until someone updates QuickBooks by hand and clears it.
alter table public.client_invoices add column if not exists quickbooks_out_of_date_at timestamptz;
comment on column public.client_invoices.quickbooks_out_of_date_at is
  'Set when a QuickBooks-linked invoice is revised in the app. Cleared only after someone updates the QuickBooks copy by hand and marks it current.';

-- The invoice fields every revision audit records, before and after.
create function finance_internal.invoice_revision_record(p_invoice public.client_invoices)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('invoice_number',(p_invoice).invoice_number,'invoice_date',(p_invoice).invoice_date,
    'status',(p_invoice).status,'title',(p_invoice).title,'description',(p_invoice).description,
    'terms',(p_invoice).terms,'notes',(p_invoice).notes,'line_items',(p_invoice).line_items,'amount',(p_invoice).amount,
    'sent_to_client_at',(p_invoice).sent_to_client_at,'quickbooks_invoice_id',(p_invoice).quickbooks_invoice_id,
    'quickbooks_doc_number',(p_invoice).quickbooks_doc_number,
    'quickbooks_out_of_date_at',(p_invoice).quickbooks_out_of_date_at,'updated_at',(p_invoice).updated_at)
$$;

drop function public.revise_client_invoice(uuid,uuid,timestamptz,text,text,jsonb,text);
drop function public.mcp_revise_client_invoice(uuid,uuid,uuid,timestamptz,text,text,jsonb,text);
drop function finance_internal.revise_invoice(uuid,uuid,uuid,timestamptz,text,text,jsonb,text);

-- p_description: null keeps the current description, blank clears it.
create function finance_internal.revise_invoice(
  p_actor_id uuid, p_invoice_id uuid, p_project_id uuid, p_expected_updated_at timestamptz,
  p_title text, p_terms text, p_line_items jsonb, p_reason text, p_description text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_invoice public.client_invoices%rowtype;
  v_before jsonb;
  v_amount numeric := 0;
  v_line jsonb;
  v_old_lines jsonb;
  v_issued boolean;
  v_qb_linked boolean;
  v_changed boolean;
begin
  perform finance_internal.require_actor(p_actor_id);
  if p_title is null or length(btrim(p_title)) not between 1 and 500
    or p_reason is null or length(btrim(p_reason)) not between 1 and 2000
    or p_terms is null or length(p_terms)>2000 or p_expected_updated_at is null then
    raise exception 'Provide a title, terms, reason and current invoice version.';
  end if;
  if p_description is not null and length(p_description)>4000 then raise exception 'Keep the description under 4,000 characters.'; end if;
  if p_line_items is null or jsonb_typeof(p_line_items)<>'array' then raise exception 'Provide invoice lines.'; end if;
  if jsonb_array_length(p_line_items) not between 1 and 200 then raise exception 'Provide 1 to 200 lines.'; end if;
  for v_line in select value from jsonb_array_elements(p_line_items) loop
    if jsonb_typeof(v_line)<>'object' or jsonb_typeof(v_line->'description') is distinct from 'string'
      or length(btrim(v_line->>'description')) not between 1 and 4000
      or jsonb_typeof(v_line->'amount') is distinct from 'number'
      or exists(select 1 from jsonb_object_keys(v_line) k where k not in ('description','amount','change_order_id'))
      or (v_line ? 'change_order_id' and (jsonb_typeof(v_line->'change_order_id') is distinct from 'string'
        or v_line->>'change_order_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
      raise exception 'Invalid invoice line.';
    end if;
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
  if v_invoice.status='paid' or v_invoice.paid_at is not null or coalesce(v_invoice.paid_amount,0)<>0
    or exists(select 1 from public.payments_received where client_invoice_id=p_invoice_id) then
    raise exception 'A paid invoice or one with applied receipts cannot be revised.';
  end if;
  if v_invoice.status is null or v_invoice.status not in ('draft','sent') then
    raise exception 'Only a draft or sent invoice can be revised.';
  end if;

  -- A change-order credit applied through the credit workflow stays on the
  -- invoice with its amount; new change-order links only come from that workflow.
  v_old_lines := case when jsonb_typeof(v_invoice.line_items)='array' then v_invoice.line_items else '[]'::jsonb end;
  if exists(select 1 from jsonb_array_elements(v_old_lines) o where o ? 'change_order_id'
      and not exists(select 1 from jsonb_array_elements(p_line_items) n
        where n->>'change_order_id'=o->>'change_order_id' and (n->>'amount')::numeric=(o->>'amount')::numeric)) then
    raise exception 'Keep each applied change order credit line at its amount. Change the credit through its change order.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_line_items) n where n ? 'change_order_id'
      and not exists(select 1 from jsonb_array_elements(v_old_lines) o where o->>'change_order_id'=n->>'change_order_id'))
    or exists(select 1 from jsonb_array_elements(p_line_items) n where n ? 'change_order_id'
      group by n->>'change_order_id' having count(*)>1) then
    raise exception 'Apply a change order credit through the credit workflow, not as an edited line.';
  end if;

  v_issued := v_invoice.status<>'draft' or v_invoice.sent_to_client_at is not null;
  v_qb_linked := v_invoice.quickbooks_invoice_id is not null or v_invoice.quickbooks_id is not null
    or v_invoice.quickbooks_doc_number is not null;
  v_before := finance_internal.invoice_revision_record(v_invoice);
  update public.client_invoices set title=btrim(p_title),terms=p_terms,line_items=p_line_items,amount=v_amount,
    description=case when p_description is null then description else nullif(btrim(p_description),'') end,
    updated_at=clock_timestamp() where id=p_invoice_id returning * into v_invoice;
  v_changed := (v_before->'title',v_before->'description',v_before->'terms',v_before->'line_items',v_before->'amount')
    is distinct from (to_jsonb(v_invoice.title),to_jsonb(v_invoice.description),to_jsonb(v_invoice.terms),
      v_invoice.line_items,to_jsonb(v_invoice.amount));
  if v_qb_linked and v_changed then
    update public.client_invoices set quickbooks_out_of_date_at=v_invoice.updated_at
      where id=p_invoice_id returning * into v_invoice;
  end if;
  insert into finance_internal.client_billing_audit(actor_id,project_id,invoice_id,operation,reason,before_record,after_record)
    values(p_actor_id,p_project_id,p_invoice_id,case when v_issued then 'revise_sent' else 'revise_draft' end,
      btrim(p_reason),v_before,finance_internal.invoice_revision_record(v_invoice));
  -- Preserve signed milestone/contract amounts; this revises billing only.
  return jsonb_build_object('id',v_invoice.id,'invoice_number',v_invoice.invoice_number,
    'invoice_date',v_invoice.invoice_date,'amount',v_invoice.amount,'status',v_invoice.status,
    'updated_at',v_invoice.updated_at,'operation',case when v_issued then 'revise_sent' else 'revise_draft' end,
    'quickbooks_out_of_date_at',v_invoice.quickbooks_out_of_date_at,
    'quickbooks_note',case when v_invoice.quickbooks_out_of_date_at is not null then
      'QuickBooks was not changed. Its copy'||coalesce(' '||v_invoice.quickbooks_doc_number,'')
        ||' still shows the old invoice until someone updates it there by hand.' end);
end;
$$;

create function public.revise_client_invoice(
  p_invoice_id uuid,p_project_id uuid,p_expected_updated_at timestamptz,
  p_title text,p_terms text,p_line_items jsonb,p_reason text,p_description text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return finance_internal.revise_invoice(auth.uid(),p_invoice_id,p_project_id,p_expected_updated_at,
    p_title,p_terms,p_line_items,p_reason,p_description);
end;
$$;
revoke all on function public.revise_client_invoice(uuid,uuid,timestamptz,text,text,jsonb,text,text) from public,anon,service_role;
grant execute on function public.revise_client_invoice(uuid,uuid,timestamptz,text,text,jsonb,text,text) to authenticated;

create function public.mcp_revise_client_invoice(
  p_actor_id uuid,p_invoice_id uuid,p_project_id uuid,p_expected_updated_at timestamptz,
  p_title text,p_terms text,p_line_items jsonb,p_reason text,p_description text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted MCP service required.'; end if;
  return finance_internal.revise_invoice(p_actor_id,p_invoice_id,p_project_id,p_expected_updated_at,
    p_title,p_terms,p_line_items,p_reason,p_description);
end;
$$;
revoke all on function public.mcp_revise_client_invoice(uuid,uuid,uuid,timestamptz,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.mcp_revise_client_invoice(uuid,uuid,uuid,timestamptz,text,text,jsonb,text,text) to service_role;

-- Clear the flag after the QuickBooks copy was updated by hand. The caller
-- passes the flag time it saw, so a later revision keeps the invoice flagged.
create function finance_internal.mark_quickbooks_current(
  p_actor_id uuid, p_invoice_id uuid, p_project_id uuid, p_expected_out_of_date_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_invoice public.client_invoices%rowtype;
begin
  perform finance_internal.require_actor(p_actor_id);
  select * into v_invoice from public.client_invoices where id=p_invoice_id and project_id=p_project_id for update;
  if not found then raise exception 'Invoice not found in this project.'; end if;
  if v_invoice.quickbooks_out_of_date_at is null then
    return jsonb_build_object('id',v_invoice.id,'quickbooks_out_of_date_at',null,'already_current',true);
  end if;
  if v_invoice.quickbooks_out_of_date_at is distinct from p_expected_out_of_date_at then
    raise exception 'This invoice was revised again. Check QuickBooks against the latest version.';
  end if;
  update public.client_invoices set quickbooks_out_of_date_at=null where id=p_invoice_id;
  insert into finance_internal.client_billing_audit(actor_id,project_id,invoice_id,operation,reason,before_record,after_record)
    values(p_actor_id,p_project_id,p_invoice_id,'quickbooks_marked_current',
      'QuickBooks copy updated by hand to match the revised invoice',
      jsonb_build_object('quickbooks_out_of_date_at',v_invoice.quickbooks_out_of_date_at,
        'quickbooks_doc_number',v_invoice.quickbooks_doc_number,'amount',v_invoice.amount),
      jsonb_build_object('quickbooks_out_of_date_at',null));
  return jsonb_build_object('id',v_invoice.id,'quickbooks_out_of_date_at',null);
end;
$$;

create function public.mark_client_invoice_quickbooks_current(
  p_invoice_id uuid, p_project_id uuid, p_expected_out_of_date_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return finance_internal.mark_quickbooks_current(auth.uid(),p_invoice_id,p_project_id,p_expected_out_of_date_at);
end;
$$;
revoke all on function public.mark_client_invoice_quickbooks_current(uuid,uuid,timestamptz) from public,anon,service_role;
grant execute on function public.mark_client_invoice_quickbooks_current(uuid,uuid,timestamptz) to authenticated;

-- Billing read: expose the description, issue date and stale QuickBooks flag.
create or replace function public.mcp_get_client_billing(p_actor_id uuid,p_project_id uuid)
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
      'description',description,'invoice_date',invoice_date,
      'line_items',line_items,'amount',amount,'terms',terms,'status',status,'paid_amount',paid_amount,
      'paid_at',paid_at,'due_date',due_date,'sent_to_client_at',sent_to_client_at,'updated_at',updated_at,
      'has_external_accounting_link',quickbooks_invoice_id is not null or quickbooks_id is not null or quickbooks_doc_number is not null,
      'quickbooks_doc_number',quickbooks_doc_number,'quickbooks_out_of_date_at',quickbooks_out_of_date_at)
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

-- Invoices already corrected by hand before this workflow existed keep their
-- stale QuickBooks copy flagged until someone clears it.
update public.client_invoices ci set quickbooks_out_of_date_at=a.revised_at
from (select invoice_id,max(created_at) revised_at from finance_internal.client_billing_audit
  where operation='revise_sent' group by invoice_id) a
where ci.id=a.invoice_id and ci.quickbooks_out_of_date_at is null
  and (ci.quickbooks_invoice_id is not null or ci.quickbooks_id is not null or ci.quickbooks_doc_number is not null);

notify pgrst, 'reload schema';
