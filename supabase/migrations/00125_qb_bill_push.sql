-- Unpaid vendor bills now mirror into QBO as Bills the moment they're filed
-- (Jorge 8/19: "it should go out as a bill to QuickBooks right away").
-- quickbooks_bill_id links the app row to its QBO Bill; Mark-paid then posts
-- a BillPayment against it instead of a standalone Purchase.
alter table invoices
  add column if not exists quickbooks_bill_id text;
