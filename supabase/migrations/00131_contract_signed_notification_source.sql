-- notifyTeamOfContractSignature writes source_type = 'contract_signed', but the
-- check constraint was never widened when the contract e-sign flow landed, so
-- every client signature logged "could not persist notifications: ... violates
-- check constraint app_notifications_source_type_check" and Jorge/Ryan/Nicole
-- got no in-app bell (push + the executed-contract email still went out).

alter table app_notifications
  drop constraint app_notifications_source_type_check;

alter table app_notifications
  add constraint app_notifications_source_type_check
  check (source_type = any (array[
    'company_post',
    'daily_log',
    'project_update',
    'feed_comment',
    'field_invoice',
    'client_payment',
    'bill_pay_approval',
    'phone_line',
    'contract_signed'
  ]::text[]));
