-- ============================================================
-- 00119: Deposit capture (money IN)
-- ============================================================
-- The twin of 00112 field invoice capture. That one photographs a receipt and
-- files money OUT; this one photographs the CHECK a client handed over and
-- files money IN against the job.
--
-- Until now nothing in the app UI could write a payments_received row at all --
-- only the AI email engine, the chat tool handler and the QuickBooks sync. A
-- client check handed to Ryan on a jobsite had no way into the books.
--
-- Same shape as the receipt side deliberately: the scan route proposes and
-- writes nothing, the commit route is the only writer, and a read the model
-- was not confident about lands flagged rather than silently wrong.

-- ------------------------------------------------------------
-- 1. Capture columns on payments_received
-- ------------------------------------------------------------
alter table public.payments_received
  add column if not exists payer_name          text,
  add column if not exists photo_storage_path  text,
  add column if not exists photo_bucket        text,
  add column if not exists extracted_text      text,
  add column if not exists source              text,
  add column if not exists review_status       text not null default 'ok',
  add column if not exists review_reason       text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments_received'::regclass
      and conname = 'payments_received_review_status_check'
  ) then
    alter table public.payments_received
      add constraint payments_received_review_status_check
      check (review_status in ('ok', 'needs_review'));
  end if;
end $$;

-- Deliberately mirrors invoices.review_status: a half-read check still counts
-- toward money received instead of vanishing until someone blesses it.
create index if not exists payments_received_review_status_idx
  on public.payments_received (review_status)
  where review_status = 'needs_review';

comment on column public.payments_received.payer_name is
  'Who the payment came from as read off the check -- often the client''s '
  'personal or trust name, which will not match the project name.';
comment on column public.payments_received.photo_storage_path is
  'Path in photo_bucket of the captured check / deposit slip photo.';
comment on column public.payments_received.review_status is
  'ok | needs_review. needs_review means the AI was not confident about the '
  'payer, amount or job and a human must confirm it.';
comment on column public.payments_received.source is
  'deposit_capture | email | quickbooks | chat -- how the row got here.';

-- ------------------------------------------------------------
-- 2. Notifications for captured deposits
-- ------------------------------------------------------------
-- kind stays 'invoice' (the money-movement bucket); source_type distinguishes
-- a client payment from a vendor bill so the two never collide on the
-- (recipient, source_type, source_id) dedup key.
alter table public.app_notifications
  drop constraint if exists app_notifications_source_type_check;
alter table public.app_notifications
  add constraint app_notifications_source_type_check
  check (source_type in (
    'company_post', 'daily_log', 'project_update', 'feed_comment',
    'field_invoice', 'client_payment'
  ));

-- ------------------------------------------------------------
-- 3. Storage
-- ------------------------------------------------------------
-- Reuses the field-captures bucket (same 10MB image-only policy set from
-- 00112). Deposit photos are namespaced under {profileId}/deposits/ so the
-- "is this your capture" path check in the commit routes still holds for both.
