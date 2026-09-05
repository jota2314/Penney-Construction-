alter table public.inbox_emails add column if not exists estimating_intake_checked_at timestamptz;
create index if not exists inbox_estimating_intake_pending_idx on public.inbox_emails(created_at desc) where direction='inbound' and content_type='inquiry' and project_id is null and estimating_intake_checked_at is null;
