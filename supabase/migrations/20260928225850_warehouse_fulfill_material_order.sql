-- Mark Picked (fulfillMaterialOrder in src/lib/actions/warehouse.ts) calls this
-- RPC, but it only ever existed in 00090_data_integrity_fixes.sql, which was never
-- applied live. This applies ONLY the warehouse part of 00090; its other sections
-- (split_vendor_invoice, budget_vs_actual) were superseded by later migrations.
--
-- One transaction: locks the order, requires every order line exactly once,
-- deducts stock for catalog lines (refusing to go negative), writes an
-- order_fulfillment ledger row per catalog line, records quantity_fulfilled,
-- and moves the order to 'ready'.
--
-- Applied live 2026-09-28 via Supabase MCP apply_migration (same version).

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

revoke all on function public.warehouse_fulfill_material_order(uuid, jsonb, text) from public, anon;
grant execute on function public.warehouse_fulfill_material_order(uuid, jsonb, text) to authenticated;
