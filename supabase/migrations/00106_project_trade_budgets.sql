-- Per-trade sub budgets for the project Subs tab.
--
-- The Subs tab (sub awarding + management) shows one card per trade with
-- budget vs. quoted vs. awarded. The budget normally derives from the
-- estimate's line-item costs, but the PM can set/override a number per
-- trade here — including on projects with no estimate yet. One row per
-- (project, trade); trade is stored as a normalized lowercase key.

create table if not exists public.project_trade_budgets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  trade text not null,
  budget_amount numeric(12, 2) not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, trade)
);

create index if not exists idx_project_trade_budgets_project
  on public.project_trade_budgets (project_id);

alter table public.project_trade_budgets enable row level security;

drop policy if exists "Authenticated full access" on public.project_trade_budgets;
create policy "Authenticated full access" on public.project_trade_budgets
  for all to authenticated using (true) with check (true);
