-- Isolated PostgreSQL/PGlite fixtures. These tables are never installed live.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('test.uid',true),'')::uuid
$$;
create function auth.role() returns text language sql as $$
  select nullif(current_setting('test.role',true),'')
$$;
grant usage on schema public,auth to authenticated,anon,service_role;
create table public.profiles(id uuid primary key,role text);
create table public.projects(
  id uuid primary key default gen_random_uuid(), name text, project_number text,
  contract_status text, contract_locked_amount numeric, contract_value numeric
);
create table public.client_invoices(
  id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id),
  invoice_number integer, title text, description text, line_items jsonb, amount numeric,
  terms text, due_date date, status text, notes text, approval_token uuid default gen_random_uuid(),
  sent_to_client_at timestamptz, client_email text, client_viewed_at timestamptz,
  client_view_count integer, paid_at timestamptz, paid_amount numeric, gmail_message_id text,
  created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  quickbooks_invoice_id text, quickbooks_id text, quickbooks_doc_number text,
  quickbooks_pushed_at timestamptz, unique(project_id,invoice_number)
);
create table public.change_orders(
  id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id),
  change_order_number integer, title text, description text, status text,
  approved_at timestamptz, approved_by text, cost_impact numeric, price_impact numeric,
  client_invoice_id uuid references public.client_invoices(id),
  quickbooks_estimate_id text, quickbooks_pushed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique(project_id,change_order_number)
);
create table public.payments_received(
  id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id),
  client_invoice_id uuid references public.client_invoices(id), change_order_id uuid,
  amount numeric, review_status text, received_date date, reference_number text,
  description text, updated_at timestamptz default now()
);
create table public.project_payment_milestones(
  id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id),
  client_invoice_id uuid references public.client_invoices(id), amount numeric,
  status text, updated_at timestamptz default now()
);
create table public.estimate_line_items(
  id uuid primary key default gen_random_uuid(), change_order_id uuid references public.change_orders(id),
  description text, total_price numeric
);
