-- 00087_warehouse_inventory.sql
-- Warehouse inventory + field material ordering.
--
-- Four tables:
--   warehouse_items        — the catalog: stock levels, reorder points, bin locations
--   warehouse_transactions — immutable ledger of every stock movement
--   material_orders        — material requests from field crew / office, fulfilled at the warehouse
--   material_order_items   — order line items (catalog items or free-text write-ins)
--
-- All stock changes go through warehouse_adjust_stock() so the quantity update
-- and the ledger row commit atomically and stock can never go negative.

create sequence if not exists public.warehouse_sku_seq start with 1;
create sequence if not exists public.material_order_seq start with 1;

create table public.warehouse_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique default ('WH-' || lpad(nextval('public.warehouse_sku_seq')::text, 4, '0')),
  name text not null,
  description text,
  category text not null default 'other',
  unit text not null default 'each',
  quantity_on_hand numeric not null default 0,
  reorder_point numeric not null default 0,
  reorder_quantity numeric,
  unit_cost numeric,
  location text,
  vendor text,
  barcode text,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index warehouse_items_category_idx on public.warehouse_items (category);
create index warehouse_items_active_idx on public.warehouse_items (is_active);

create table public.material_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default (
    'MO-' || extract(year from now())::text || '-' || lpad(nextval('public.material_order_seq')::text, 3, '0')
  ),
  project_id uuid references public.projects(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'ready', 'delivered', 'rejected', 'cancelled')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  delivery_method text not null default 'pickup'
    check (delivery_method in ('pickup', 'deliver_to_site')),
  needed_by date,
  notes text,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_by_name text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  fulfilled_by uuid references public.profiles(id) on delete set null,
  fulfilled_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index material_orders_status_idx on public.material_orders (status);
create index material_orders_requested_by_idx on public.material_orders (requested_by);

create table public.material_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.material_orders(id) on delete cascade,
  -- null item_id = free-text "write-in" line the warehouse doesn't stock (yet)
  item_id uuid references public.warehouse_items(id) on delete set null,
  item_name text not null,
  quantity numeric not null check (quantity > 0),
  unit text not null default 'each',
  quantity_fulfilled numeric not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create index material_order_items_order_idx on public.material_order_items (order_id);

create table public.warehouse_transactions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.warehouse_items(id) on delete cascade,
  type text not null
    check (type in ('receive', 'issue', 'return', 'adjust', 'order_fulfillment')),
  quantity_change numeric not null,
  quantity_after numeric not null,
  project_id uuid references public.projects(id) on delete set null,
  order_id uuid references public.material_orders(id) on delete set null,
  notes text,
  performed_by uuid references public.profiles(id) on delete set null,
  performed_by_name text,
  created_at timestamptz not null default now()
);

create index warehouse_transactions_item_idx
  on public.warehouse_transactions (item_id, created_at desc);

-- Atomic stock movement: the quantity update and the ledger row succeed or
-- fail together, and an issue can never take stock below zero.
create or replace function public.warehouse_adjust_stock(
  p_item_id uuid,
  p_change numeric,
  p_type text,
  p_project_id uuid default null,
  p_order_id uuid default null,
  p_notes text default null,
  p_performed_by uuid default null,
  p_performed_by_name text default null
) returns numeric
language plpgsql
set search_path = public
as $$
declare
  v_new numeric;
begin
  update public.warehouse_items
     set quantity_on_hand = quantity_on_hand + p_change,
         updated_at = now()
   where id = p_item_id
   returning quantity_on_hand into v_new;

  if v_new is null then
    raise exception 'Warehouse item not found';
  end if;
  if v_new < 0 then
    raise exception 'Not enough stock on hand for this item';
  end if;

  insert into public.warehouse_transactions
    (item_id, type, quantity_change, quantity_after, project_id, order_id,
     notes, performed_by, performed_by_name)
  values
    (p_item_id, p_type, p_change, v_new, p_project_id, p_order_id,
     p_notes, p_performed_by, p_performed_by_name);

  return v_new;
end;
$$;

create or replace function public.warehouse_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger warehouse_items_touch_updated_at
  before update on public.warehouse_items
  for each row execute function public.warehouse_touch_updated_at();

create trigger material_orders_touch_updated_at
  before update on public.material_orders
  for each row execute function public.warehouse_touch_updated_at();

-- RLS: same posture as the rest of the app — any signed-in user (office and
-- field crew both need read/write), no anonymous access.
alter table public.warehouse_items enable row level security;
alter table public.warehouse_transactions enable row level security;
alter table public.material_orders enable row level security;
alter table public.material_order_items enable row level security;

create policy "warehouse_items authenticated full access" on public.warehouse_items
  for all to authenticated using (true) with check (true);
create policy "warehouse_transactions authenticated full access" on public.warehouse_transactions
  for all to authenticated using (true) with check (true);
create policy "material_orders authenticated full access" on public.material_orders
  for all to authenticated using (true) with check (true);
create policy "material_order_items authenticated full access" on public.material_order_items
  for all to authenticated using (true) with check (true);
