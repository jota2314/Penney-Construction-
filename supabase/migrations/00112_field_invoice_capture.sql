-- ============================================================
-- 00112: Field invoice capture
-- ============================================================
-- A crew member photographs a receipt on the jobsite. Claude reads it,
-- matches it to a job and a budget line, and files it as a vendor invoice
-- (money OUT). When the AI is not confident, the row is flagged for review
-- and Nicole gets an email instead of the number landing silently.
--
-- Delivery tickets / packing slips carry no dollar amount and must NEVER
-- become an invoices row -- they are filed as project documents so they
-- cannot pollute the Spent totals. That branch is enforced in app code
-- (/api/crew/field-capture), not here.
--
-- This migration ALSO repairs split_vendor_invoice(), which both
-- /api/auto-link-invoices and /api/split-invoice/execute have always called
-- but which was never created in the database -- every multi-line invoice
-- split has been failing at runtime with "function does not exist".

-- ------------------------------------------------------------
-- 1. The missing split RPC
-- ------------------------------------------------------------
-- Replaces one vendor invoice with N children, each linked to its own budget
-- line. paid_amount is distributed pro-rata so the Finances tab's "Spent"
-- (labor + sum of paid_amount) is identical before and after a split.
create or replace function public.split_vendor_invoice(
  p_invoice_id uuid,
  p_splits     jsonb
)
returns setof public.invoices
language plpgsql
as $fn$
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

    -- Pro-rata paid split, with the remainder forced onto the last child so
    -- rounding can never lose or invent a cent.
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
        change_order_id, drive_url, drive_file_id
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
        v_original.drive_file_id
      )
      returning *
    )
    select * from ins;
  end loop;

  -- Safe: nothing in the schema references invoices.id.
  delete from public.invoices where id = p_invoice_id;
end;
$fn$;

comment on function public.split_vendor_invoice(uuid, jsonb) is
  'Replaces one vendor invoice with N children, each on its own budget line. '
  'Splits must sum to the original amount and all lines must belong to the '
  'invoice''s project. paid_amount is distributed pro-rata so Spent is unchanged.';

grant execute on function public.split_vendor_invoice(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 2. Review flag on invoices
-- ------------------------------------------------------------
-- The only status invoices had was payment_status. A field capture the AI is
-- unsure about needs to be visibly unconfirmed without being excluded from
-- the books.
alter table public.invoices
  add column if not exists review_status text not null default 'ok',
  add column if not exists review_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoices'::regclass
      and conname = 'invoices_review_status_check'
  ) then
    alter table public.invoices
      add constraint invoices_review_status_check
      check (review_status in ('ok', 'needs_review'));
  end if;
end $$;

create index if not exists invoices_review_status_idx
  on public.invoices (review_status)
  where review_status = 'needs_review';

comment on column public.invoices.review_status is
  'ok | needs_review. needs_review means an AI field capture was not confident '
  'about the job, vendor or amount and a human must confirm it.';
comment on column public.invoices.review_reason is
  'Human-readable reason the capture was flagged, shown in the review queue.';

-- ------------------------------------------------------------
-- 3. Notifications for field captures
-- ------------------------------------------------------------
alter table public.app_notifications
  drop constraint if exists app_notifications_kind_check;
alter table public.app_notifications
  add constraint app_notifications_kind_check
  check (kind in ('mention', 'comment', 'post', 'invoice'));

alter table public.app_notifications
  drop constraint if exists app_notifications_source_type_check;
alter table public.app_notifications
  add constraint app_notifications_source_type_check
  check (source_type in (
    'company_post', 'daily_log', 'project_update', 'feed_comment', 'field_invoice'
  ));

-- ------------------------------------------------------------
-- 4. Storage for captured receipt photos
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'field-captures',
  'field-captures',
  false,
  10485760, -- 10MB, same as daily-log-photos
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Authenticated users can upload field captures'
  ) then
    create policy "Authenticated users can upload field captures"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'field-captures');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Authenticated users can read field captures'
  ) then
    create policy "Authenticated users can read field captures"
      on storage.objects for select to authenticated
      using (bucket_id = 'field-captures');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Authenticated users can delete field captures'
  ) then
    create policy "Authenticated users can delete field captures"
      on storage.objects for delete to authenticated
      using (bucket_id = 'field-captures');
  end if;
end $$;
