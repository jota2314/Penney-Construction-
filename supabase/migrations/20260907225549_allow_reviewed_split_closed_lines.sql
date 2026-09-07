-- Preserve the original invoice ID, all source fields and every bank match.
-- SECURITY INVOKER deliberately uses the caller's existing RLS permissions.
create or replace function public.split_spend_invoice(p_invoice_id uuid, p_splits jsonb)
returns setof public.invoices language plpgsql security invoker set search_path = public
as $fn$
declare
  original invoices%rowtype;
  child invoices%rowtype;
  bm bank_transaction_matches%rowtype;
  match_copy bank_transaction_matches%rowtype;
  saved_matches jsonb;
  part jsonb;
  ids uuid[] := '{}';
  gid uuid;
  idx integer := 0;
  running numeric := 0;
  previous numeric := 0;
  share numeric;
  match_total numeric;
  affected_lines uuid[];
  locked_lines uuid[];
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into original from invoices where id=p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if original.quickbooks_id is not null or original.quickbooks_purchase_id is not null or original.quickbooks_bill_id is not null then
    raise exception 'This invoice is already linked to QuickBooks. Reconcile that linked transaction before splitting.';
  end if;
  if p_splits is null or jsonb_typeof(p_splits)<>'array' then raise exception 'Invalid split'; end if;
  if jsonb_array_length(p_splits)<2 or jsonb_array_length(p_splits)>40 then raise exception 'Use between 2 and 40 pieces'; end if;
  if coalesce(original.amount,0)=0 then raise exception 'Cannot split a zero amount'; end if;
  for part in select value from jsonb_array_elements(p_splits) loop
    if (part->>'amount') is null or (part->>'amount')::numeric in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      or sign((part->>'amount')::numeric)<>sign(original.amount)
      or round((part->>'amount')::numeric,2)<>(part->>'amount')::numeric then raise exception 'Invalid split amount'; end if;
    if not exists(select 1 from projects where id=coalesce(nullif(part->>'project_id','')::uuid,original.project_id)) then raise exception 'Choose an accessible job for every piece'; end if;
    if nullif(part->>'line_item_id','') is not null and not exists(
      select 1 from estimate_line_items l join estimates e on e.id=l.estimate_id
      where l.id=(part->>'line_item_id')::uuid and e.project_id=coalesce(nullif(part->>'project_id','')::uuid,original.project_id)
        and not coalesce(l.is_section_header,false)
    ) then raise exception 'Choose a budget line belonging to the piece job'; end if;
  end loop;
  if (select sum((value->>'amount')::numeric) from jsonb_array_elements(p_splits))<>original.amount then raise exception 'Split must balance exactly'; end if;
  select array_agg(distinct line_id) into affected_lines from (
    select original.estimate_line_item_id as line_id
    union select nullif(value->>'line_item_id','')::uuid from jsonb_array_elements(p_splits)
  ) candidates where line_id is not null;
  perform id from estimate_line_items where id=any(affected_lines) order by id for update;
  select array_agg(id) into locked_lines from estimate_line_items where id=any(affected_lines) and is_locked;
  if coalesce(cardinality(locked_lines),0)>0 and not exists (
    select 1 from profiles where id=auth.uid() and role::text in ('owner','office_admin','precon_manager')
  ) then raise exception 'Office access required to assign a closed budget line' using errcode='42501'; end if;
  -- Scoped to this explicit review, in the same atomic transaction as the split.
  update estimate_line_items set is_locked=false where id=any(locked_lines);
  perform 1 from bank_transaction_matches where invoice_id=original.id for update;
  select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb),coalesce(sum(amount_applied),0) into saved_matches,match_total from bank_transaction_matches m where invoice_id=original.id;
  gid:=coalesce(original.split_group_id,gen_random_uuid());
  for part in select value from jsonb_array_elements(p_splits) loop
    idx:=idx+1;
    child:=original;
    child.id:=case when idx=1 then original.id else gen_random_uuid() end;
    ids:=array_append(ids,child.id);
    child.amount:=(part->>'amount')::numeric;
    previous:=running; running:=running+child.amount;
    child.paid_amount:=case when original.paid_amount is null then null else
      round(original.paid_amount*running/original.amount,2)-round(original.paid_amount*previous/original.amount,2) end;
    child.project_id:=coalesce(nullif(part->>'project_id','')::uuid,original.project_id);
    child.estimate_line_item_id:=nullif(part->>'line_item_id','')::uuid;
    child.description:=coalesce(nullif(part->>'note',''),original.description);
    child.split_group_id:=gid;
    child.review_status:=case when child.estimate_line_item_id is null then 'needs_review' else 'ok' end;
    child.review_reason:=case when child.estimate_line_item_id is null then 'Split saved; choose the budget line for this piece.' else null end;
    child.notes:=coalesce(original.notes,'')||E'\nUser-reviewed split of invoice '||original.id||' ('||original.amount||'), piece '||idx||': '||coalesce(part->>'note','');
    child.updated_at:=now();
    -- A change order belongs to one project. Do not carry it to another job.
    if child.project_id is distinct from original.project_id then child.change_order_id:=null;child.quote_request_id:=null; end if;
    if idx=1 then
      update invoices set amount=child.amount,paid_amount=child.paid_amount,project_id=child.project_id,
        estimate_line_item_id=child.estimate_line_item_id,description=child.description,split_group_id=gid,
        review_status=child.review_status,review_reason=child.review_reason,notes=child.notes,
        change_order_id=child.change_order_id,quote_request_id=child.quote_request_id,updated_at=now() where id=original.id;
    else
      child.created_at:=now();insert into invoices select child.*;
    end if;
    for bm in select * from jsonb_populate_recordset(null::bank_transaction_matches,saved_matches) loop
      share:=round(bm.amount_applied*running/original.amount,2)-round(bm.amount_applied*previous/original.amount,2);
      if idx=1 then
        if share=0 then delete from bank_transaction_matches where id=bm.id;
        else update bank_transaction_matches set amount_applied=share,confidence='manual' where id=bm.id; end if;
      elsif share<>0 then
        match_copy:=bm;match_copy.id:=gen_random_uuid();match_copy.invoice_id:=child.id;
        match_copy.amount_applied:=share;match_copy.confidence:='manual';
        insert into bank_transaction_matches select match_copy.*;
      end if;
    end loop;
  end loop;
  -- Multiple partial payments can round differently from their aggregate.
  if original.paid_amount=match_total and match_total<>0 then
    update invoices i set paid_amount=coalesce((select sum(amount_applied) from bank_transaction_matches m where m.invoice_id=i.id),0) where i.id=any(ids);
  end if;
  if (select sum(amount) from invoices where id=any(ids))<>original.amount
    or (select coalesce(sum(paid_amount),0) from invoices where id=any(ids))<>coalesce(original.paid_amount,0)
    or (select coalesce(sum(amount_applied),0) from bank_transaction_matches where invoice_id=any(ids))<>match_total then raise exception 'Split totals did not balance'; end if;
  update estimate_line_items l set
    is_locked=true,
    closed_invoice_cost=(select coalesce(sum(i.amount),0) from invoices i where i.estimate_line_item_id=l.id),
    closed_margin=l.closed_price-coalesce(l.closed_labor_cost,0)
      -(select coalesce(sum(i.amount),0) from invoices i where i.estimate_line_item_id=l.id)
  where l.id=any(locked_lines);
  return query select * from invoices where id=any(ids);
end;
$fn$;
revoke all on function public.split_spend_invoice(uuid,jsonb) from public,anon;
grant execute on function public.split_spend_invoice(uuid,jsonb) to authenticated;
