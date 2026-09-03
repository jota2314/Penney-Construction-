-- Two "approved for pay" stamps drifted apart: the project Invoices tab wrote
-- approved_for_pay_at only; the Invoices list / spent detail / office bill
-- dialog wrote pay_approval_status only. /invoices and /spent read just the
-- second, so a tab approval (Ryan, WRD Pro Painting $7,500 Parziale, 9/2)
-- still showed "To approve" and Nicole re-asked. App code now writes both;
-- this brings the existing rows into line, both directions.

update invoices
set pay_approval_status = 'approved',
    pay_approved_at = coalesce(pay_approved_at, approved_for_pay_at),
    pay_approved_by = coalesce(pay_approved_by, approved_for_pay_by)
where approved_for_pay_at is not null
  and pay_approval_status is distinct from 'approved';

update invoices
set approved_for_pay_at = pay_approved_at,
    approved_for_pay_by = pay_approved_by
where pay_approval_status = 'approved'
  and approved_for_pay_at is null
  and pay_approved_at is not null;
