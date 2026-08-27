-- Nicole can hand a cost she cannot place to Jorge or Ryan, in the app,
-- without leaving the row. The helper opens it and sets the job + budget
-- line themselves, so the person who knows the answer is the one entering
-- it and there is nothing to relay back.

alter table invoices
  add column if not exists help_requested_at  timestamptz,
  add column if not exists help_requested_by  uuid references profiles(id),
  add column if not exists help_note          text,
  add column if not exists help_resolved_at   timestamptz,
  add column if not exists help_resolved_by   uuid references profiles(id);

comment on column invoices.help_requested_at is
  'Set when someone asks Jorge/Ryan which job + budget line this cost belongs to. Cleared when the line is set.';

-- The open-questions queue: small, and read on every spend-organizer load.
create index if not exists invoices_help_open_idx
  on invoices (help_requested_at desc)
  where help_requested_at is not null and help_resolved_at is null;

-- Notifications carry a new kind + source so the bell can route straight to
-- the row that needs an answer.
alter table app_notifications drop constraint if exists app_notifications_kind_check;
alter table app_notifications add constraint app_notifications_kind_check
  check (kind = any (array['mention','comment','post','invoice','sms','call','help']));

alter table app_notifications drop constraint if exists app_notifications_source_type_check;
alter table app_notifications add constraint app_notifications_source_type_check
  check (source_type = any (array['company_post','daily_log','project_update','feed_comment',
                                  'field_invoice','client_payment','bill_pay_approval',
                                  'phone_line','contract_signed','spend_help']));
