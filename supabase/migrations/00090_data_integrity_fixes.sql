-- Close public billing-data access and make high-risk multi-row writes atomic.

drop policy if exists client_invoices_public_read_by_token
  on public.client_invoices;

create or replace function public.warehouse_fulfill_material_order(
  p_order_id uuid,
  p_lines jsonb,
  p_performed_by_name text default null
) returns void
language plpgsql
set search_path = public
as $$
declare
  v_order public.material_orders%rowtype;
  v_order_line public.material_order_items%rowtype;
  v_line jsonb;
  v_quantity numeric;
  v_new_quantity numeric;
  v_order_line_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one fulfillment line is required';
  end if;

  select * into v_order
  from public.material_orders
  where id = p_order_id
  for update;

  if not found then raise exception 'Order not found'; end if;
  if v_order.status not in ('pending', 'approved') then
    raise exception 'Order is already %', v_order.status;
  end if;

  select count(*) into v_order_line_count
  from public.material_order_items
  where order_id = p_order_id;

  if jsonb_array_length(p_lines) <> v_order_line_count
     or (
       select count(distinct value->>'orderItemId')
       from jsonb_array_elements(p_lines)
     ) <> v_order_line_count then
    raise exception 'Every order line must be fulfilled exactly once';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_quantity := (v_line->>'quantity')::numeric;
    if v_quantity <= 0 then
      raise exception 'Fulfillment quantities must be greater than zero';
    end if;

    select * into v_order_line
    from public.material_order_items
    where id = (v_line->>'orderItemId')::uuid
      and order_id = p_order_id
    for update;

    if not found then raise exception 'Order line not found'; end if;
    if v_order_line.quantity_fulfilled > 0 then
      raise exception 'Order line is already fulfilled';
    end if;
    if v_quantity > v_order_line.quantity then
      raise exception 'Fulfilled quantity exceeds requested quantity';
    end if;

    if v_order_line.item_id is not null then
      update public.warehouse_items
      set quantity_on_hand = quantity_on_hand - v_quantity,
          updated_at = now()
      where id = v_order_line.item_id
        and quantity_on_hand >= v_quantity
      returning quantity_on_hand into v_new_quantity;

      if v_new_quantity is null then
        raise exception 'Not enough stock on hand for %', v_order_line.item_name;
      end if;

      insert into public.warehouse_transactions (
        item_id, type, quantity_change, quantity_after, project_id, order_id,
        notes, performed_by, performed_by_name
      ) values (
        v_order_line.item_id, 'order_fulfillment', -v_quantity, v_new_quantity,
        v_order.project_id, v_order.id, 'Order ' || v_order.order_number,
        auth.uid(), p_performed_by_name
      );
    end if;

    update public.material_order_items
    set quantity_fulfilled = v_quantity
    where id = v_order_line.id;
  end loop;

  update public.material_orders
  set status = 'ready',
      fulfilled_by = auth.uid(),
      fulfilled_at = now()
  where id = p_order_id;
end;
$$;

create or replace function public.split_vendor_invoice(
  p_invoice_id uuid,
  p_splits jsonb
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_split jsonb;
  v_amount numeric;
  v_total numeric := 0;
  v_created jsonb := '[]'::jsonb;
  v_created_row public.invoices%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) < 2 then
    raise exception 'At least two splits are required';
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then raise exception 'Invoice not found'; end if;

  for v_split in select value from jsonb_array_elements(p_splits)
  loop
    v_amount := (v_split->>'amount')::numeric;
    if v_amount <= 0 then raise exception 'Split amounts must be positive'; end if;
    if not exists (
      select 1
      from public.estimate_line_items eli
      join public.estimates e on e.id = eli.estimate_id
      where eli.id = (v_split->>'line_item_id')::uuid
        and e.project_id = v_invoice.project_id
    ) then
      raise exception 'Budget line does not belong to the invoice project';
    end if;
    v_total := v_total + v_amount;
  end loop;

  if abs(v_total - v_invoice.amount) > 0.01 then
    raise exception 'Split total must equal the original invoice amount';
  end if;

  for v_split in select value from jsonb_array_elements(p_splits)
  loop
    v_amount := (v_split->>'amount')::numeric;
    insert into public.invoices (
      project_id, vendor_name, vendor_type, trade, invoice_number, invoice_date,
      due_date, terms, amount, paid_amount, payment_status, paid_date,
      description, estimate_line_item_id, subcontractor_id, quote_request_id,
      gmail_message_id, attachment_storage_path, created_by
    ) values (
      v_invoice.project_id, v_invoice.vendor_name, v_invoice.vendor_type,
      v_invoice.trade, v_invoice.invoice_number, v_invoice.invoice_date,
      v_invoice.due_date, v_invoice.terms, v_amount,
      case when v_invoice.amount = 0 then 0
           else round(v_invoice.paid_amount * v_amount / v_invoice.amount, 2)
      end,
      v_invoice.payment_status, v_invoice.paid_date,
      coalesce(nullif(v_split->>'note', ''), v_invoice.description),
      (v_split->>'line_item_id')::uuid, v_invoice.subcontractor_id,
      v_invoice.quote_request_id, v_invoice.gmail_message_id,
      v_invoice.attachment_storage_path, auth.uid()
    )
    returning * into v_created_row;

    v_created := v_created || jsonb_build_array(jsonb_build_object(
      'id', v_created_row.id,
      'description', v_created_row.description,
      'amount', v_created_row.amount
    ));
  end loop;

  delete from public.invoices where id = p_invoice_id;
  return v_created;
end;
$$;

revoke all on function public.warehouse_fulfill_material_order(uuid, jsonb, text) from public, anon;
grant execute on function public.warehouse_fulfill_material_order(uuid, jsonb, text) to authenticated;
revoke all on function public.split_vendor_invoice(uuid, jsonb) from public, anon;
grant execute on function public.split_vendor_invoice(uuid, jsonb) to authenticated;

-- Report only the active estimate version and prefer authoritative financial
-- columns. Without this filter, every historical estimate version was summed
-- into the project budget UI.
create or replace view public.budget_vs_actual
with (security_invoker = true)
as
select
  eli.id as line_item_id,
  eli.estimate_id,
  e.project_id,
  eli.description,
  eli.trade,
  eli.sort_order,
  coalesce(eli.cost, eli.total_cost, 0) as budgeted_cost,
  coalesce(eli.client_price, eli.total_price, 0) as budgeted_price,
  coalesce(eli.profit, 0) as budgeted_profit,
  coalesce(inv.invoiced_amount, 0) as actual_invoiced,
  coalesce(inv.paid_amount, 0) as actual_paid,
  coalesce(eli.cost, eli.total_cost, 0) - coalesce(inv.invoiced_amount, 0) as variance,
  case
    when coalesce(eli.cost, eli.total_cost, 0) > 0
    then round((
      coalesce(inv.invoiced_amount, 0)
      / coalesce(eli.cost, eli.total_cost, 0) * 100
    )::numeric, 1)
    else 0
  end as percent_spent
from public.estimate_line_items eli
join public.estimates e on eli.estimate_id = e.id
left join (
  select
    i.estimate_line_item_id,
    sum(i.amount) as invoiced_amount,
    sum(i.paid_amount) as paid_amount
  from public.invoices i
  where i.estimate_line_item_id is not null
  group by i.estimate_line_item_id
) inv on inv.estimate_line_item_id = eli.id
where e.version = (
  select max(e2.version)
  from public.estimates e2
  where e2.project_id = e.project_id
    and e2.status in ('approved', 'draft')
);
