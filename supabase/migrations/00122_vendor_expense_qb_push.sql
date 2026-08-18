-- Vendor invoices → QuickBooks expense push.
-- payment_method records HOW a bill was settled (drives the QBO txn type:
-- credit_card → Purchase paid from the filer's Capital One subaccount).
-- quickbooks_purchase_id/pushed_at make the push idempotent; push_error keeps
-- a failed push visible without blocking the filing itself.

alter table invoices
  add column if not exists payment_method text
    check (payment_method in ('credit_card', 'check', 'cash', 'ach')),
  add column if not exists quickbooks_purchase_id text,
  add column if not exists quickbooks_pushed_at timestamptz,
  add column if not exists quickbooks_push_error text;

comment on column invoices.payment_method is
  'How Penney paid this bill. credit_card = company Capital One card (per-person subaccounts in QBO).';
comment on column invoices.quickbooks_purchase_id is
  'QBO Purchase.Id created by the app push. quickbooks_id also gets qb_purchase_<Id> so the QB sync dedupes against it.';

-- split_vendor_invoice: carry payment_method onto the children, so a
-- check-paid receipt split across budget lines doesn't push to QBO as a
-- card charge. Body otherwise identical to 00112.
create or replace function public.split_vendor_invoice(p_invoice_id uuid, p_splits jsonb)
returns setof invoices
language plpgsql
as $function$
declare
  v_original    public.invoices%rowtype;
  v_split_total numeric;
  v_paid_total  numeric := 0;
  v_split       jsonb;
  v_amount      numeric;
  v_paid_share  numeric;
  v_idx         int := 0;
  v_count       int;
begin
  select * into v_original from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;

  if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) < 2 then
    raise exception 'split_vendor_invoice needs at least 2 splits; link the invoice directly instead';
  end if;
  v_count := jsonb_array_length(p_splits);

  select sum((s->>'amount')::numeric) into v_split_total
  from jsonb_array_elements(p_splits) s;

  -- Guard the money: the parts must equal the whole.
  if abs(v_split_total - coalesce(v_original.amount, 0)) > 0.01 then
    raise exception 'Splits total % does not equal invoice amount %',
      v_split_total, coalesce(v_original.amount, 0);
  end if;

  -- Every target line must belong to this invoice's project, or a split could
  -- quietly move cost onto another job's budget.
  if exists (
    select 1
    from jsonb_array_elements(p_splits) s
    where not exists (
      select 1
      from public.estimate_line_items eli
      join public.estimates e on e.id = eli.estimate_id
      where eli.id = (s->>'line_item_id')::uuid
        and e.project_id = v_original.project_id
    )
  ) then
    raise exception 'One or more budget lines do not belong to this invoice''s project';
  end if;

  for v_split in select * from jsonb_array_elements(p_splits)
  loop
    v_idx    := v_idx + 1;
    v_amount := (v_split->>'amount')::numeric;

    -- Pro-rata paid split, remainder forced onto the last child so rounding
    -- can never lose or invent a cent.
    if v_idx = v_count then
      v_paid_share := coalesce(v_original.paid_amount, 0) - v_paid_total;
    else
      v_paid_share := round(
        coalesce(v_original.paid_amount, 0)
          * (v_amount / nullif(v_original.amount, 0)), 2);
      v_paid_total := v_paid_total + v_paid_share;
    end if;

    return query
    with ins as (
      insert into public.invoices (
        project_id, vendor_name, vendor_type, trade, invoice_number, invoice_date,
        due_date, terms, description, amount, paid_amount, payment_status, paid_date,
        quote_request_id, gmail_message_id, attachment_storage_path, extracted_text,
        notes, created_by, estimate_line_item_id, subcontractor_id, source,
        change_order_id, drive_url, drive_file_id, payment_method
      )
      values (
        v_original.project_id, v_original.vendor_name, v_original.vendor_type,
        v_original.trade, v_original.invoice_number, v_original.invoice_date,
        v_original.due_date, v_original.terms,
        coalesce(nullif(v_split->>'note', ''), v_original.description),
        v_amount, v_paid_share, v_original.payment_status, v_original.paid_date,
        v_original.quote_request_id, v_original.gmail_message_id,
        v_original.attachment_storage_path, v_original.extracted_text,
        v_original.notes, v_original.created_by,
        (v_split->>'line_item_id')::uuid, v_original.subcontractor_id,
        v_original.source, v_original.change_order_id, v_original.drive_url,
        v_original.drive_file_id, v_original.payment_method
      )
      returning *
    )
    select * from ins;
  end loop;

  -- Safe: nothing in the schema references invoices.id.
  delete from public.invoices where id = p_invoice_id;
end;
$function$;
