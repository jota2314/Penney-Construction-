-- Material dealers wrongly typed as subcontractors.
--
-- Every invoice writer in the app defaulted `vendor_type` to 'subcontractor'
-- (AI extraction, the inbox router, split-quote, createInvoice), so lumberyards
-- and building-supply houses landed on both sides of the books: Building Center
-- of Essex alone had 38 bills typed subcontractor and 80 typed supplier. The
-- Weekly Close listed those 38 under "Payments to subs" and the QuickBooks push
-- booked them to Subcontractors Expense instead of Construction Materials Costs.
--
-- The code now decides by vendor NAME (src/lib/finance/spend-category.ts:
-- MATERIAL_SUPPLIER_VENDORS / resolveVendorType), which fixes display and all
-- future rows. This backfills the rows already stored, keeping the pattern in
-- sync with the TypeScript one (\y here is Postgres's word boundary).
--
-- Rollback: the previous value of every touched row is kept in
-- vendor_type_backfill_00128, so
--   update invoices i set vendor_type = b.old_vendor_type
--   from vendor_type_backfill_00128 b where b.invoice_id = i.id;
-- restores the exact prior state.

create table if not exists vendor_type_backfill_00128 (
  invoice_id uuid primary key references invoices(id) on delete cascade,
  old_vendor_type text not null,
  backfilled_at timestamptz not null default now()
);

alter table vendor_type_backfill_00128 enable row level security;

insert into vendor_type_backfill_00128 (invoice_id, old_vendor_type)
select id, vendor_type
from invoices
where vendor_type = 'subcontractor'
  and vendor_name ~* '(build\w*\s+center|building products|\ylumber\y|\ymillwork\y|mould?ing|\ymolding\y|home\s*depot|\ylowe.?s\y|menards|hardware|aubuchon|auchuchon|true value|\ysupply\y|\ysupplies\y|floor\s*(&|and)\s*decor|sherwin|benjamin moore|koopman|moynihan)'
on conflict (invoice_id) do nothing;

update invoices i
set vendor_type = 'supplier'
from vendor_type_backfill_00128 b
where b.invoice_id = i.id
  and i.vendor_type = 'subcontractor';
