-- Only loaded by the isolated PGlite tests; never installed on a live database.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('test.uid',true),'')::uuid
$$;
create table auth.users(id uuid primary key);
create table public.profiles(id uuid primary key references auth.users(id),role text);
create table public.projects(id uuid primary key default gen_random_uuid(),assigned_pm uuid references profiles(id));
create table public.change_orders(
  id uuid primary key default gen_random_uuid(),project_id uuid references projects(id),
  status text not null default 'draft',price_impact numeric default 0,cost_impact numeric default 0,
  title text,description text,updated_at timestamptz default clock_timestamp(),
  sent_to_client_at timestamptz,client_signed_at timestamptz,client_signature text,approved_at timestamptz
);
create table public.estimate_line_items(id uuid primary key default gen_random_uuid(),change_order_id uuid references change_orders(id));
create table public.schedule_phases(id uuid primary key default gen_random_uuid(),project_id uuid references projects(id),estimate_line_item_id uuid references estimate_line_items(id));
create table public.daily_logs(
  id uuid primary key default gen_random_uuid(),project_id uuid references projects(id),
  schedule_phase_id uuid references schedule_phases(id),estimate_line_item_id uuid references estimate_line_items(id),
  author_id uuid references auth.users(id),started_at timestamptz,ended_at timestamptz,kind text default 'work',
  status text default 'completed',line_item_needs_review boolean default false,text text,
  photo_storage_paths text[],updated_at timestamptz default clock_timestamp()
);
create table public.invoices(
  id uuid primary key default gen_random_uuid(),project_id uuid references projects(id),
  change_order_id uuid references change_orders(id),estimate_line_item_id uuid references estimate_line_items(id),
  invoice_date date default '2026-10-23',amount numeric default 100,description text default 'Concrete',
  duplicate_of_id uuid,review_status text default 'ok',updated_at timestamptz default clock_timestamp()
);
grant usage on schema public,auth to authenticated,anon,service_role;
grant select on public.profiles,public.projects,public.estimate_line_items,public.schedule_phases,
  public.daily_logs,public.invoices to authenticated,service_role;
grant select,insert,update on public.change_orders to authenticated,service_role;
-- Existing app source tables permit office edits; FOR SHARE requires UPDATE privilege.
grant update on public.daily_logs,public.invoices to authenticated;
-- Match permissive Supabase defaults so migration revokes are actually exercised.
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
