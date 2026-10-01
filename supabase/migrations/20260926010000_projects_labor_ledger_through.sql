-- Clock jobs whose early weeks were booked from Nicole's Drive ledger as In-House Labor
-- rows. Clocked time on or before this date keeps its hours and wages but adds no
-- job cost, so those weeks are not counted twice. Null = no ledger-covered weeks.
alter table public.projects add column if not exists labor_ledger_through date;
comment on column public.projects.labor_ledger_through is
  'Last work date whose crew wages are already booked as In-House Labor ledger rows; clocked labor on or before it adds no job cost.';
