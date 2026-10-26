-- Re-split a receipt that is ALREADY in pieces, as one whole document.
-- split_spend_invoice cuts a single row, so a capture that landed as two
-- pieces on the wrong job could only be moved piece by piece, never re-cut by
-- job (BC of Essex credit 17807, 10/26: five jobs on one refund slip, booked
-- as two O'Mealia pieces). This folds the group's live pieces back into its
-- oldest row and hands that row to split_spend_invoice, in one transaction.
-- SECURITY INVOKER deliberately uses the caller's existing RLS permissions.
create or replace function public.resplit_spend_group(p_group_id uuid, p_splits jsonb)
returns setof public.invoices language plpgsql security invoker set search_path = public
as $fn$
declare
  piece_ids uuid[];
  other_ids uuid[];
  survivor_id uuid;
  group_total numeric;
  group_paid numeric;
  folded text;
  merged_matches jsonb;
  touched_lines uuid[];
  locked_lines uuid[];
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_group_id is null then raise exception 'This receipt is not split into pieces'; end if;
  if p_splits is null or jsonb_typeof(p_splits)<>'array' then raise exception 'Invalid split'; end if;

  -- Rows marked duplicate_of_id are hidden copies, not pieces; leave them be.
  perform 1 from invoices where split_group_id=p_group_id and duplicate_of_id is null order by id for update;
  select array_agg(id order by created_at, id) into piece_ids
    from invoices where split_group_id=p_group_id and duplicate_of_id is null;
  if coalesce(cardinality(piece_ids),0)=0 then raise exception 'Receipt not found'; end if;
  survivor_id:=piece_ids[1];
  other_ids:=piece_ids[2:];

  -- QuickBooks gets a split group as ONE transaction, so either every piece
  -- carries its id or none does.
  if exists(select 1 from invoices where id=any(piece_ids)
      and (quickbooks_id is not null or quickbooks_purchase_id is not null or quickbooks_bill_id is not null)) then
    raise exception 'This receipt is already in QuickBooks. Reconcile that transaction before re-splitting.';
  end if;
  if (select count(distinct coalesce(payment_status,'')) from invoices where id=any(piece_ids))>1 then
    raise exception 'The pieces of this receipt disagree on paid or unpaid. Fix that before re-splitting.';
  end if;

  select sum(amount),
         case when bool_and(paid_amount is null) then null else sum(coalesce(paid_amount,0)) end,
         string_agg(coalesce(p.project_number,'no job')||' '||i.amount, ', ' order by i.created_at, i.id)
    into group_total, group_paid, folded
    from invoices i left join projects p on p.id=i.project_id
   where i.id=any(piece_ids);

  -- Closed lines: the same office-only rule split_spend_invoice applies, but
  -- over every line the old pieces sat on too, or their closed cost goes stale.
  select array_agg(distinct line_id) into touched_lines from (
    select estimate_line_item_id as line_id from invoices where id=any(piece_ids)
    union select nullif(value->>'line_item_id','')::uuid from jsonb_array_elements(p_splits)
  ) candidates where line_id is not null;
  perform id from estimate_line_items where id=any(touched_lines) order by id for update;
  select array_agg(id) into locked_lines from estimate_line_items where id=any(touched_lines) and is_locked;
  if coalesce(cardinality(locked_lines),0)>0 and not exists (
    select 1 from profiles where id=auth.uid() and role::text in ('owner','office_admin','precon_manager')
  ) then raise exception 'Office access required to assign a closed budget line' using errcode='42501'; end if;
  update estimate_line_items set is_locked=false where id=any(locked_lines);

  -- One match per bank line on the surviving row (uq_btm_bank_invoice), summed;
  -- split_spend_invoice then shares each one across the new pieces.
  select coalesce(jsonb_agg(jsonb_build_object('bank_transaction_id',bank_transaction_id,'amount_applied',total)),'[]'::jsonb)
    into merged_matches
    from (select bank_transaction_id, sum(amount_applied) total from bank_transaction_matches
           where invoice_id=any(piece_ids) group by bank_transaction_id) m;
  delete from bank_transaction_matches where invoice_id=any(piece_ids);
  insert into bank_transaction_matches(id, bank_transaction_id, invoice_id, amount_applied, confidence, matched_by, matched_at)
  select gen_random_uuid(), (m->>'bank_transaction_id')::uuid, survivor_id, (m->>'amount_applied')::numeric, 'manual', auth.uid(), now()
    from jsonb_array_elements(merged_matches) m;

  -- A hidden copy of a folded piece must keep pointing at a live row; the FK's
  -- ON DELETE SET NULL would otherwise turn it back into a counted cost.
  update invoices set duplicate_of_id=survivor_id where duplicate_of_id=any(other_ids);
  delete from invoices where id=any(other_ids);
  update invoices set amount=group_total, paid_amount=group_paid,
    notes=coalesce(notes,'')||E'\nRe-split as one receipt, folded '||cardinality(piece_ids)||' pieces: '||folded,
    updated_at=now()
   where id=survivor_id;

  return query select * from split_spend_invoice(survivor_id, p_splits);

  update estimate_line_items l set
    is_locked=true,
    closed_invoice_cost=(select coalesce(sum(i.amount),0) from invoices i where i.estimate_line_item_id=l.id),
    closed_margin=l.closed_price-coalesce(l.closed_labor_cost,0)
      -(select coalesce(sum(i.amount),0) from invoices i where i.estimate_line_item_id=l.id)
  where l.id=any(locked_lines);
  return;
end;
$fn$;

revoke all on function public.resplit_spend_group(uuid, jsonb) from public, anon;
grant execute on function public.resplit_spend_group(uuid, jsonb) to authenticated, service_role;
