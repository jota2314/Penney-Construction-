-- 00129: Close the income loop + repair lost finance data.
--
-- 1) bank_transaction_matches learns to match DEPOSITS (payments_received),
--    not only bills: invoice_id becomes nullable, payment_id is added, and a
--    check keeps exactly one target per row.
-- 2) Paid bills missing paid_date get one (their bank-match date, else the
--    invoice date). paid_date_source marks every backfilled row, so the
--    backfill is identifiable and reversible (null it back where source is
--    set); rows the app dated stay untouched (source NULL).
-- 3) The paid client invoices whose cash never entered payments_received
--    (the "vanishing payment" bug, fixed in code alongside this): link the
--    existing unlinked payment when exactly one matches on amount, insert a
--    backfill payment otherwise, and flip milestones of paid invoices to
--    'paid'.
-- 4) Auto-match unmatched bank lines 1:1 on amount(±$1) + date(±5d), only
--    when the pairing is unambiguous in BOTH directions. matched_by NULL +
--    the "(00129)" match_note on the bank row mark this pass, so it is
--    reversible (delete those match rows, reset match_status + note).
-- 5) Cancelled projects stop carrying contract_value (kept per-row in
--    contract_value_backfill_00129 for exact reversal) — $591k of phantom
--    "contracted" value otherwise leaks into any unfiltered sum.

-- ── (1) Deposit matches ─────────────────────────────────────────────────────
-- The old PK was (bank_transaction_id, invoice_id), which forces invoice_id
-- NOT NULL — a deposit match has no invoice. Move to a surrogate id + one
-- partial unique index per target kind. No app code addresses this table
-- (matches were written by repair sessions), so nothing depends on the old key.
alter table bank_transaction_matches drop constraint bank_transaction_matches_pkey;
alter table bank_transaction_matches add column id uuid not null default gen_random_uuid();
alter table bank_transaction_matches add primary key (id);
alter table bank_transaction_matches alter column invoice_id drop not null;
alter table bank_transaction_matches
  add column if not exists payment_id uuid references payments_received(id) on delete cascade;
alter table bank_transaction_matches
  add constraint btm_exactly_one_target check ((invoice_id is null) <> (payment_id is null));
create unique index if not exists uq_btm_bank_invoice
  on bank_transaction_matches(bank_transaction_id, invoice_id) where invoice_id is not null;
create unique index if not exists uq_btm_bank_payment
  on bank_transaction_matches(bank_transaction_id, payment_id) where payment_id is not null;

-- ── (2) paid_date backfill ──────────────────────────────────────────────────
alter table invoices add column if not exists paid_date_source text;

update invoices i
set paid_date = s.d, paid_date_source = 'bank_match_00129'
from (
  select m.invoice_id, min(b.txn_date) as d
  from bank_transaction_matches m
  join bank_transactions b on b.id = m.bank_transaction_id
  where m.invoice_id is not null
  group by m.invoice_id
) s
where s.invoice_id = i.id
  and i.payment_status = 'paid'
  and i.paid_date is null;

update invoices
set paid_date = invoice_date, paid_date_source = 'invoice_date_00129'
where payment_status = 'paid'
  and paid_date is null
  and invoice_date is not null;

-- ── (3) Lost client-invoice payments ────────────────────────────────────────
with cand as (
  select ci.id as inv_id, pr.id as pay_id
  from client_invoices ci
  join payments_received pr
    on pr.project_id = ci.project_id
   and pr.client_invoice_id is null
   and abs(pr.amount - coalesce(ci.paid_amount, ci.amount)) < 1
  where ci.status = 'paid'
    and not exists (select 1 from payments_received x where x.client_invoice_id = ci.id)
),
uniq as (
  select inv_id, pay_id from cand
  where inv_id in (select inv_id from cand group by inv_id having count(*) = 1)
    and pay_id in (select pay_id from cand group by pay_id having count(*) = 1)
)
update payments_received pr
set client_invoice_id = u.inv_id
from uniq u
where pr.id = u.pay_id;

insert into payments_received
  (project_id, payment_type, description, amount, received_date, client_invoice_id, source, created_by)
select
  ci.project_id,
  case when m.stage_key = 'deposit' then 'deposit'
       when m.stage_key ilike '%final%' then 'final'
       else 'draw' end,
  'Invoice #' || ci.invoice_number || ' — ' || ci.title,
  coalesce(ci.paid_amount, ci.amount),
  coalesce(ci.paid_at::date, current_date),
  ci.id,
  'invoice_paid_backfill_00129',
  ci.created_by
from client_invoices ci
left join lateral (
  select stage_key from project_payment_milestones
  where client_invoice_id = ci.id
  limit 1
) m on true
where ci.status = 'paid'
  and not exists (select 1 from payments_received pr where pr.client_invoice_id = ci.id);

update project_payment_milestones m
set status = 'paid', updated_at = now()
from client_invoices ci
where ci.id = m.client_invoice_id
  and ci.status = 'paid'
  and m.status is distinct from 'paid';

-- ── (4a) Deposit auto-match ─────────────────────────────────────────────────
with cand as (
  select b.id as bank_id, pr.id as pay_id, b.amount as bank_amount
  from bank_transactions b
  join payments_received pr
    on abs(b.amount - pr.amount) < 1
   and abs(b.txn_date - pr.received_date) <= 5
  where b.direction = 'credit'
    and b.match_status = 'unmatched'
    and not exists (select 1 from bank_transaction_matches m where m.payment_id = pr.id)
),
uniq as (
  select bank_id, pay_id, bank_amount from cand
  where bank_id in (select bank_id from cand group by bank_id having count(*) = 1)
    and pay_id in (select pay_id from cand group by pay_id having count(*) = 1)
),
ins as (
  -- confidence is CHECK-limited to exact|amount_date|vendor_fuzzy|split_sum|
  -- manual; these ARE amount+date matches. matched_by NULL + the 00129 note
  -- on the bank row mark this pass for reversal.
  insert into bank_transaction_matches (bank_transaction_id, payment_id, amount_applied, confidence, matched_at)
  select bank_id, pay_id, bank_amount, 'amount_date', now() from uniq
  returning bank_transaction_id
)
update bank_transactions b
set match_status = 'matched',
    match_note = coalesce(match_note, 'auto-matched to a recorded payment (00129)')
where b.id in (select bank_transaction_id from ins);

-- ── (4b) Bill auto-match (Eastern-paid bills only — card/internal rows never
--        hit the account individually, so they are excluded) ────────────────
with cand as (
  select b.id as bank_id, i.id as inv_id, b.amount as bank_amount
  from bank_transactions b
  join invoices i
    on abs(b.amount - coalesce(nullif(i.paid_amount, 0), i.amount)) < 1
   and abs(b.txn_date - coalesce(i.paid_date, i.invoice_date)) <= 5
  where b.direction = 'debit'
    and b.match_status = 'unmatched'
    and i.payment_status = 'paid'
    and coalesce(i.payment_method, '') not in ('capital_one', 'internal', 'credit_card')
    and not exists (select 1 from bank_transaction_matches m where m.invoice_id = i.id)
),
uniq as (
  select bank_id, inv_id, bank_amount from cand
  where bank_id in (select bank_id from cand group by bank_id having count(*) = 1)
    and inv_id in (select inv_id from cand group by inv_id having count(*) = 1)
),
ins as (
  insert into bank_transaction_matches (bank_transaction_id, invoice_id, amount_applied, confidence, matched_at)
  select bank_id, inv_id, bank_amount, 'amount_date', now() from uniq
  returning bank_transaction_id
)
update bank_transactions b
set match_status = 'matched',
    match_note = coalesce(match_note, 'auto-matched to a paid bill (00129)')
where b.id in (select bank_transaction_id from ins);

-- ── (5) Cancelled projects: no phantom contract value ───────────────────────
alter table projects add column if not exists contract_value_backfill_00129 numeric;

update projects
set contract_value_backfill_00129 = contract_value,
    contract_value = null
where status = 'cancelled'
  and contract_value is not null;
