-- 00134: record "approved for pay" on vendor bills.
-- Set by the Approve for Pay button on the project Invoices tab; the approval
-- email to Nicole (CC Jorge + Ryan) goes out via notifyBillApprovedForPay.
alter table invoices
  add column if not exists approved_for_pay_at timestamptz,
  add column if not exists approved_for_pay_by uuid references profiles(id);
