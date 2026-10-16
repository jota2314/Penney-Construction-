-- Job-site QR code for subs.
--
-- Every job can print a QR sign (window, binder cover). Scanning it opens
-- www.penneyconstruction.build/sub/j/{site_code}: a sub who already has a
-- portal login lands on that job's log (clock in, photos); a sub who doesn't
-- signs up on the spot with phone + PIN and is in right away (Jorge, 10/13).
--
-- site_code is a short random code, not the project id, so the QR carries no
-- guessable identifier and one job's code can be replaced without touching
-- anything else. Minted lazily the first time someone opens the job's QR.

alter table public.projects
  add column if not exists site_code text;

create unique index if not exists projects_site_code_key
  on public.projects (site_code)
  where site_code is not null;

-- Office notification when a sub signs up or scans in from a job QR.
-- Keeps every source type already allowed live (incl. the material_* ones).
alter table public.app_notifications
  drop constraint if exists app_notifications_source_type_check;
alter table public.app_notifications
  add constraint app_notifications_source_type_check
  check (source_type in (
    'company_post', 'daily_log', 'project_update', 'feed_comment',
    'field_invoice', 'client_payment', 'bill_pay_approval', 'phone_line',
    'contract_signed', 'spend_help', 'sub_schedule', 'material_return',
    'material_order', 'material_order_ready', 'material_order_rejected',
    'sub_signup'
  ));
