-- Salaried vs hourly employees.
--
-- Payroll computed cost as hours × employees.hourly_rate and warned about
-- anyone with no rate ("N workers have no hourly rate set"). Ryan (Owner),
-- Bill Crowley (PM) and Howie (Field Lead) are salaried — they will never
-- have an hourly rate to set, so the warning could never be cleared.
--
-- pay_type marks how a person is paid. It does not change how cost is
-- computed: a salaried person who still carries an hourly_rate (an internal
-- cost rate for job costing) keeps costing jobs exactly as before.

alter table public.employees
  add column if not exists pay_type text not null default 'hourly';

alter table public.employees
  drop constraint if exists employees_pay_type_check;

alter table public.employees
  add constraint employees_pay_type_check
  check (pay_type in ('hourly', 'salary'));

comment on column public.employees.pay_type is
  'How this person is paid: hourly (payroll expects an hourly_rate) or salary (no hourly rate needed; hourly_rate, if set, is an internal cost rate for job costing only).';

update public.employees
set pay_type = 'salary'
where lower(email) in (
  'rpenney@penneyconstructioninc.com',
  'bcrowley@penneyconstructioninc.com',
  'hclick@penneyconstructioninc.com'
);
