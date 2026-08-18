-- Crew pickups on a supplier house account: the ticket has a total but
-- nobody paid at the counter — the supply house bills monthly. Filing those
-- as card-paid invented expenses and set up a double-count when the
-- statement arrived. 'on_account' records the truth: cost lands on the job
-- now, payment_status stays unpaid, and nothing goes to QuickBooks until the
-- supplier's bill is actually paid (Mark paid overwrites the method then).
alter table invoices drop constraint if exists invoices_payment_method_check;
alter table invoices
  add constraint invoices_payment_method_check
  check (payment_method in ('credit_card', 'check', 'cash', 'ach', 'on_account'));
