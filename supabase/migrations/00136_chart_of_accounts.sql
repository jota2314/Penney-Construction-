-- Chart of accounts + month close.
--
-- Until now "chart of accounts" was a set of regex rules in
-- src/lib/finance/spend-category.ts, run at render time on the invoices
-- table, money-out only, nothing stored. Bank statement lines carried a
-- separate 17-key category. This migration gives the books one persisted
-- account per money movement and a real period lock.
--
--   accounts               the chart: income / cogs / expense / asset /
--                          liability / equity / transfer. spend_key ties a
--                          row to the existing SPEND_CATEGORIES bucket (and
--                          therefore the QBO push); bank_key ties it to
--                          bank_transactions.category_key.
--   invoices.account_id    stored account for a bill (writers set it, the
--                          backfill action fills history, readers fall back
--                          to the rules when null).
--   bank_transactions.account_id
--                          stored account for a statement line — THE ledger
--                          line for cash-basis reporting.
--   accounting_periods     one row per month; 'locked' months reject money
--                          edits via assert_accounting_period_open().
--   subcontractors.w9_*    what the 1099 report needs Nicole to track.

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null check (type in ('income','cogs','expense','asset','liability','equity','transfer')),
  qbo_name text,
  spend_key text unique,
  bank_key text,
  is_active boolean not null default true,
  is_system boolean not null default false,
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.accounts (code, name, type, qbo_name, spend_key, bank_key, is_system, sort_order) values
  ('4000', 'Construction Income',            'income',    'Construction Income',           null,           'income',      true, 10),
  ('4900', 'Other Income',                   'income',    'Other Income',                  null,           null,          false, 20),
  ('5000', 'Subcontractors',                 'cogs',      'Subcontractors Expense',        'subs',         'subs',        true, 100),
  ('5100', 'Construction Materials',         'cogs',      'Construction Materials Costs',  'materials',    'materials',   true, 110),
  ('5200', 'Payroll Wages',                  'cogs',      'Payroll Salary & Wages',        'labor',        'labor',       true, 120),
  ('5250', 'Payroll Taxes & Service',        'expense',   'Payroll Taxes',                 null,           null,          false, 125),
  ('5300', 'Disposal & Site',                'cogs',      'Other Construction Costs',      'site',         'site',        true, 130),
  ('5400', 'Permits & Fees',                 'cogs',      'Permits & Fees',                'permits',      'permits',     true, 140),
  ('5500', 'Tools & Small Equipment',        'cogs',      'Tools and Small Equipment',     'tools',        'tools',       true, 150),
  ('5600', 'Fuel',                           'cogs',      'Fuel Expense',                  'fuel',         'fuel',        true, 160),
  ('6000', 'Auto & Truck',                   'expense',   'Auto and Truck Expenses',       'vehicles',     'vehicles',    true, 200),
  ('6100', 'Insurance',                      'expense',   'Insurance Expense',             'insurance',    'insurance',   true, 210),
  ('6200', 'Software & Subscriptions',       'expense',   'Software & Subscriptions',      'software',     'software',    true, 220),
  ('6300', 'Utilities & Rent',               'expense',   'Utilities',                     'utilities',    'utilities',   true, 230),
  ('6400', 'Legal & Accounting',             'expense',   'Legal & Accounting',            'professional', null,          true, 240),
  ('6500', 'Licenses & Dues',                'expense',   'Licenses and Permits',          'licenses',     'licenses',    true, 250),
  ('6600', 'Advertising',                    'expense',   'Advertising',                   'marketing',    'marketing',   true, 260),
  ('6700', 'Bank Service Charges',           'expense',   'Bank Service Charges',          'bank',         'bank',        true, 270),
  ('6800', 'Meals & Entertainment',          'expense',   'Meals and Entertainment',       'meals',        'meals',       true, 280),
  ('6900', 'Office Expense',                 'expense',   'Office Expense',                'office',       'office',      true, 290),
  ('6950', 'Loan Interest',                  'expense',   'Interest Expense',              null,           null,          false, 300),
  ('1500', 'Vehicles & Equipment (assets)',  'asset',     'Fixed Assets',                  null,           null,          true, 400),
  ('2500', 'Loan Principal',                 'liability', 'Loans Payable',                 null,           null,          false, 500),
  ('3000', 'Owner Draws',                    'equity',    'Owner Draws',                   null,           null,          false, 600),
  ('3100', 'Owner Contributions',            'equity',    'Owner Contributions',           null,           null,          false, 610),
  ('9000', 'Credit Card Payments',           'transfer',  'Credit Card Payments',          'cardpay',      'card_payoff', true, 900),
  ('9100', 'Transfers Between Accounts',     'transfer',  'Transfers',                     null,           null,          true, 910),
  ('9900', 'Uncategorized',                  'expense',   'Uncategorized Expense',         null,           null,          true, 999)
on conflict (code) do nothing;

alter table public.invoices          add column if not exists account_id uuid references public.accounts(id);
alter table public.bank_transactions add column if not exists account_id uuid references public.accounts(id);
create index if not exists invoices_account_id_idx          on public.invoices(account_id);
create index if not exists bank_transactions_account_id_idx on public.bank_transactions(account_id);

alter table public.subcontractors
  add column if not exists w9_on_file boolean not null default false,
  add column if not exists w9_received_at date,
  add column if not exists legal_name text,
  add column if not exists tax_id_last4 text,
  add column if not exists is_1099_eligible boolean not null default true;

-- ---------------------------------------------------------------------------
-- SQL-side backfill: everything decidable without the TS rulebook.
-- ---------------------------------------------------------------------------

-- Bank lines already tagged: category_key → account.
update public.bank_transactions b
   set account_id = a.id
  from public.accounts a
 where b.account_id is null and b.category_key is not null and a.bank_key = b.category_key;

-- Payoffs out of Eastern and their arrival on the card are the same transfer.
update public.bank_transactions
   set account_id = (select id from public.accounts where code = '9000')
 where account_id is null
   and ((direction = 'debit'  and description ~* 'capital one.*(pmt|payment)|amex.*(pmt|payment)|american express.*(pmt|payment)')
     or (source = 'capone' and direction = 'credit' and description ~* '^payment'));

-- Money into the operating account is income unless someone says otherwise.
update public.bank_transactions
   set account_id = (select id from public.accounts where code = '4000')
 where account_id is null and direction = 'credit' and source like 'eastern%';

-- Card-side credits that are not payments are merchandise refunds.
update public.bank_transactions
   set account_id = (select id from public.accounts where code = '5100')
 where account_id is null and direction = 'credit' and source = 'capone';

-- Payroll service: wages vs taxes/fees.
update public.bank_transactions
   set account_id = (select id from public.accounts where code = '5250')
 where account_id is null and direction = 'debit' and description ~* 'adp (tax|fees?)';
update public.bank_transactions
   set account_id = (select id from public.accounts where code = '5200')
 where account_id is null and direction = 'debit' and description ~* 'adp wage';

-- Bills: the two things the rules could never say.
update public.invoices set account_id = (select id from public.accounts where code = '1500')
 where account_id is null and is_capex = true;
update public.invoices set account_id = (select id from public.accounts where code = '5250')
 where account_id is null and vendor_name ~* 'adp tax';
update public.invoices set account_id = (select id from public.accounts where code = '5200')
 where account_id is null and vendor_name ~* '^adp( payroll)?$|adp wage';

-- ---------------------------------------------------------------------------
-- Month close.
-- ---------------------------------------------------------------------------

create table if not exists public.accounting_periods (
  month date primary key check (month = date_trunc('month', month)::date),
  status text not null default 'open' check (status in ('open','locked')),
  locked_at timestamptz,
  locked_by uuid references public.profiles(id),
  reopened_at timestamptz,
  reopened_by uuid references public.profiles(id),
  note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.accounting_period_events (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  action text not null check (action in ('lock','reopen')),
  actor_id uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now()
);

-- Reject money edits in a locked month. Arguments: the row's date column,
-- then the columns whose change counts as a money edit (so stamping a
-- QuickBooks id or an approval on an old bill still works).
-- set_config('app.bypass_period_lock','on', true) inside a transaction
-- lets an owner's reopen/backfill through.
create or replace function public.assert_accounting_period_open()
returns trigger
language plpgsql
as $$
declare
  date_col text := tg_argv[0];
  guarded  text[] := tg_argv[1:];
  new_j jsonb;
  old_j jsonb;
  d_new date;
  d_old date;
  col text;
  changed boolean := false;
begin
  if coalesce(current_setting('app.bypass_period_lock', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op <> 'DELETE' then
    new_j := to_jsonb(new);
    d_new := nullif(new_j ->> date_col, '')::date;
  end if;
  if tg_op <> 'INSERT' then
    old_j := to_jsonb(old);
    d_old := nullif(old_j ->> date_col, '')::date;
  end if;

  if tg_op = 'UPDATE' then
    foreach col in array guarded loop
      if (new_j -> col) is distinct from (old_j -> col) then
        changed := true;
        exit;
      end if;
    end loop;
    if not changed then
      return new;
    end if;
  end if;

  if d_new is not null and exists (
    select 1 from public.accounting_periods p
     where p.month = date_trunc('month', d_new)::date and p.status = 'locked'
  ) then
    raise exception '% is closed. Reopen the month under Finances → Books → Close before changing this.',
      to_char(d_new, 'Mon YYYY') using errcode = 'P0001';
  end if;

  if d_old is not null and (tg_op = 'DELETE' or d_old is distinct from d_new) and exists (
    select 1 from public.accounting_periods p
     where p.month = date_trunc('month', d_old)::date and p.status = 'locked'
  ) then
    raise exception '% is closed. Reopen the month under Finances → Books → Close before changing this.',
      to_char(d_old, 'Mon YYYY') using errcode = 'P0001';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_period_lock_invoices on public.invoices;
create trigger trg_period_lock_invoices
  before insert or update or delete on public.invoices
  for each row execute function public.assert_accounting_period_open(
    'invoice_date', 'amount', 'paid_amount', 'payment_status', 'invoice_date', 'paid_date',
    'project_id', 'vendor_name', 'account_id', 'estimate_line_item_id', 'payment_method');

drop trigger if exists trg_period_lock_bank_transactions on public.bank_transactions;
create trigger trg_period_lock_bank_transactions
  before insert or update or delete on public.bank_transactions
  for each row execute function public.assert_accounting_period_open(
    'txn_date', 'amount', 'txn_date', 'direction', 'category_key', 'account_id', 'project_id', 'match_status');

drop trigger if exists trg_period_lock_payments_received on public.payments_received;
create trigger trg_period_lock_payments_received
  before insert or update or delete on public.payments_received
  for each row execute function public.assert_accounting_period_open(
    'received_date', 'amount', 'received_date', 'project_id', 'payment_type', 'client_invoice_id');

-- ---------------------------------------------------------------------------
-- RLS — same posture as the rest of the app: any signed-in user reads; the
-- app layer decides who may write (owners for the chart and the close).
-- ---------------------------------------------------------------------------
alter table public.accounts enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.accounting_period_events enable row level security;

drop policy if exists accounts_read on public.accounts;
create policy accounts_read on public.accounts for select to authenticated using (true);
drop policy if exists accounts_write on public.accounts;
create policy accounts_write on public.accounts for all to authenticated using (true) with check (true);

drop policy if exists accounting_periods_read on public.accounting_periods;
create policy accounting_periods_read on public.accounting_periods for select to authenticated using (true);
drop policy if exists accounting_periods_write on public.accounting_periods;
create policy accounting_periods_write on public.accounting_periods for all to authenticated using (true) with check (true);

drop policy if exists accounting_period_events_read on public.accounting_period_events;
create policy accounting_period_events_read on public.accounting_period_events for select to authenticated using (true);
drop policy if exists accounting_period_events_write on public.accounting_period_events;
create policy accounting_period_events_write on public.accounting_period_events for insert to authenticated with check (true);
