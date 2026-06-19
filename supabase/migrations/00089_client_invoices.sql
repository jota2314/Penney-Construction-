-- Client invoices: money the CLIENT owes Penney (distinct from the `invoices`
-- table, which tracks vendor/subcontractor bills Penney OWES). Mirrors the
-- change_orders pipeline: create → branded PDF → send to client (+ CC Ryan).
--
-- line_items is a JSONB array of { description, amount } so a single invoice can
-- itemize e.g. contracted scope + extras (the Gallucci case: $7,000 window +
-- $1,200 extras = $8,200) without a separate child table.

create table if not exists public.client_invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  invoice_number integer not null,
  title text not null,
  description text,
  line_items jsonb not null default '[]'::jsonb,
  amount numeric not null default 0,
  terms text default 'Due on receipt',
  due_date date,
  status text not null default 'draft',          -- draft | sent | paid | void
  notes text,
  approval_token uuid default gen_random_uuid(),  -- client view link
  sent_to_client_at timestamptz,
  client_email text,
  client_viewed_at timestamptz,
  client_view_count integer default 0,
  paid_at timestamptz,
  paid_amount numeric,
  gmail_message_id text,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (project_id, invoice_number)
);

create index if not exists client_invoices_project_id_idx on public.client_invoices (project_id);

alter table public.client_invoices enable row level security;

-- Mirror change_orders RLS: authenticated users (internal team) get full access;
-- anon can read/view by approval token for the client-facing view link.
create policy client_invoices_select on public.client_invoices
  for select to authenticated using (true);
create policy client_invoices_insert on public.client_invoices
  for insert to authenticated with check (true);
create policy client_invoices_update on public.client_invoices
  for update to authenticated using (true);
create policy client_invoices_delete on public.client_invoices
  for delete to authenticated using (true);
create policy client_invoices_public_read_by_token on public.client_invoices
  for select to anon using (approval_token is not null);
