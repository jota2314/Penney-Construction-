-- One vendor bill split across budget lines stays ONE bill to the eye:
-- every piece created by split_vendor_invoice shares a split_group_id so
-- the UI can collapse the pieces back into a single transaction.
-- (Applied live 2026-08-24; the 8/24 Vetro Plastering 3-way split was
-- backfilled with a shared group id in the same session.)

alter table public.invoices add column if not exists split_group_id uuid;

create index if not exists idx_invoices_split_group
  on public.invoices (split_group_id)
  where split_group_id is not null;

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
  v_group       uuid;
begin
  select * into v_original from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;

  if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) < 2 then
    raise exception 'split_vendor_invoice needs at least 2 splits; link the invoice directly instead';
  end if;
  v_count := jsonb_array_length(p_splits);

  -- Re-splitting a piece keeps it in the original bill's group.
  v_group := coalesce(v_original.split_group_id, gen_random_uuid());

  select sum((s->>'amount')::numeric) into v_split_total
  from jsonb_array_elements(p_splits) s;

  if abs(v_split_total - coalesce(v_original.amount, 0)) > 0.01 then
    raise exception 'Splits total % does not equal invoice amount %',
      v_split_total, coalesce(v_original.amount, 0);
  end if;

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
        change_order_id, drive_url, drive_file_id, payment_method,
        pay_approval_status, pay_approved_by, pay_approved_at, split_group_id
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
        v_original.drive_file_id, v_original.payment_method,
        v_original.pay_approval_status, v_original.pay_approved_by,
        v_original.pay_approved_at, v_group
      )
      returning *
    )
    select * from ins;
  end loop;

  delete from public.invoices where id = p_invoice_id;
end;
$function$;
