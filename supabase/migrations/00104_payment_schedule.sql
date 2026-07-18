-- Payment schedule milestones per project.
--
-- Powers the "Payment Schedule" card on the project Finances tab and the
-- payment schedule table on /api/generate-contract. stage_key ties a
-- milestone to a build stage (footings, framing, rough_inspection,
-- final_inspection, ...) so schedules like "deposit / rough / final" can be
-- applied as one-click presets and later matched against workflow stages.

create table if not exists public.project_payment_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sort_order integer not null default 0,
  label text not null,
  stage_key text not null default 'custom',
  percent numeric(6, 2),
  amount numeric(12, 2),
  status text not null default 'pending' check (status in ('pending', 'invoiced', 'paid')),
  client_invoice_id uuid references public.client_invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.project_payment_milestones.percent is
  'Share of the contract value (0-100). Null when the milestone carries a fixed amount instead.';
comment on column public.project_payment_milestones.amount is
  'Fixed dollar amount. Null when the milestone is percent-driven.';

create index if not exists idx_project_payment_milestones_project
  on public.project_payment_milestones (project_id, sort_order);

alter table public.project_payment_milestones enable row level security;

drop policy if exists "Authenticated full access" on public.project_payment_milestones;
create policy "Authenticated full access" on public.project_payment_milestones
  for all to authenticated using (true) with check (true);
