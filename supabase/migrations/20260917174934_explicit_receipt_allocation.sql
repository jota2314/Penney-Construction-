-- A paid label must follow an explicitly selected receipt, never infer one
-- from equal amounts or manufacture a receipt when a status changes.
create or replace function public.record_client_invoice_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_total numeric;
begin
  if new.status is distinct from 'paid' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'paid' and old.paid_amount is not distinct from new.paid_amount then
    return new;
  end if;
  if exists(select 1 from payments_received where client_invoice_id=new.id and project_id is distinct from new.project_id) then
    raise exception 'Receipt belongs to another project.';
  end if;
  select coalesce(sum(amount),0) into v_total from payments_received where client_invoice_id=new.id;
  if v_total <= 0 or v_total <> new.amount or v_total <> coalesce(new.paid_amount,new.amount) then
    raise exception 'Apply the actual receipt(s) before marking this invoice paid.';
  end if;
  return new;
end;
$$;
revoke all on function public.record_client_invoice_payment() from public, anon, authenticated;

create or replace function public.apply_client_invoice_receipt(p_invoice_id uuid, p_project_id uuid, p_receipt_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_invoice client_invoices%rowtype;
  v_receipt payments_received%rowtype;
  v_total numeric;
  v_paid_at timestamptz;
begin
  if auth.uid() is null or not exists(select 1 from profiles where id=auth.uid() and role in ('owner','office_admin','precon_manager')) then
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
  return jsonb_build_object('paid_amount',v_total,'status',case when v_total=v_invoice.amount then 'paid' else 'sent' end);
end;
$$;
revoke all on function public.apply_client_invoice_receipt(uuid,uuid,uuid) from public, anon;
grant execute on function public.apply_client_invoice_receipt(uuid,uuid,uuid) to authenticated;
