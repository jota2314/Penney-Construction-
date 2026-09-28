-- Warehouse check-out / check-in + item photos (Rick Donnelly's 9/23 requests).
--
-- CHECK-OUT / CHECK-IN
-- A checkout is an 'issue' ledger row flagged is_checkout, carrying the job
-- site (project_id) and the person who physically took it (employee_id —
-- performed_by stays "who logged it in the app", which is often Rick, not the
-- carpenter). A check-in is a 'return' row whose checkout_id points back at
-- that issue row, so partial returns add up and the app always knows what is
-- still out. When the last unit comes back the checkout closes itself
-- ('returned'); anything consumed on the job is closed by hand ('used').
-- Every stock movement still goes through warehouse_adjust_stock().
--
-- PHOTOS
-- warehouse_items.photo_path (~1600px JPEG) + photo_thumb_path (small list
-- thumbnail) in a private warehouse-photos bucket. Every signed-in user can
-- view; only owners/precon/office admins and warehouse staff (an active
-- employee titled warehouse/runner, i.e. Rick) can upload, replace or delete.
-- That rule lives in can_manage_warehouse() and is enforced by the storage
-- policies AND a trigger on the photo columns, so the open warehouse_items
-- policy can't be used to swap or clear a photo either.

-- ── 1. Ledger columns ─────────────────────────────────────────────

alter table public.warehouse_transactions
  add column if not exists employee_id uuid references public.employees(id) on delete set null,
  add column if not exists employee_name text,
  add column if not exists is_checkout boolean not null default false,
  add column if not exists checkout_id uuid references public.warehouse_transactions(id),
  add column if not exists checkout_closed_at timestamptz,
  add column if not exists checkout_close_reason text,
  add column if not exists checkout_closed_by uuid references public.profiles(id) on delete set null,
  add column if not exists checkout_closed_by_name text;

alter table public.warehouse_transactions
  add constraint warehouse_transactions_checkout_flag_check
    check (not is_checkout or type = 'issue'),
  add constraint warehouse_transactions_checkout_link_check
    check (checkout_id is null or type = 'return'),
  add constraint warehouse_transactions_checkout_close_check
    check (
      checkout_closed_at is null
      or (is_checkout and checkout_close_reason in ('returned', 'used'))
    );

comment on column public.warehouse_transactions.employee_id is
  'The person who physically took (checkout) or brought back (check-in) the item. performed_by is whoever logged it in the app.';
comment on column public.warehouse_transactions.employee_name is
  'Snapshot of the employee''s name at the time of the movement.';
comment on column public.warehouse_transactions.is_checkout is
  'True on an issue row created by Check Out — it is tracked in Out on Jobs until returned or closed.';
comment on column public.warehouse_transactions.checkout_id is
  'On a return row: the checkout (issue row) this return is against. Partial returns sum against it.';
comment on column public.warehouse_transactions.checkout_close_reason is
  'returned = every unit came back; used = the rest was consumed on the job.';

create index if not exists warehouse_transactions_checkout_idx
  on public.warehouse_transactions (checkout_id)
  where checkout_id is not null;

create index if not exists warehouse_transactions_open_checkout_idx
  on public.warehouse_transactions (created_at)
  where is_checkout and checkout_closed_at is null;

-- ── 2. warehouse_adjust_stock: carry the person + checkout link ────
-- Same behavior, same leading parameters (callers use named args), five new
-- optional ones. The signature changes, so it has to be dropped and recreated.

drop function if exists public.warehouse_adjust_stock(uuid, numeric, text, uuid, uuid, text, uuid, text);

create function public.warehouse_adjust_stock(
  p_item_id uuid,
  p_change numeric,
  p_type text,
  p_project_id uuid default null,
  p_order_id uuid default null,
  p_notes text default null,
  p_performed_by uuid default null,
  p_performed_by_name text default null,
  p_employee_id uuid default null,
  p_employee_name text default null,
  p_checkout_id uuid default null,
  p_is_checkout boolean default false,
  p_transaction_id uuid default null
)
returns numeric
language plpgsql
set search_path to 'public'
as $function$
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
    (id, item_id, type, quantity_change, quantity_after, project_id, order_id,
     notes, performed_by, performed_by_name,
     employee_id, employee_name, checkout_id, is_checkout)
  values
    (coalesce(p_transaction_id, gen_random_uuid()), p_item_id, p_type, p_change,
     v_new, p_project_id, p_order_id, p_notes, p_performed_by, p_performed_by_name,
     p_employee_id, p_employee_name, p_checkout_id, coalesce(p_is_checkout, false));

  return v_new;
end;
$function$;

revoke all on function public.warehouse_adjust_stock(uuid, numeric, text, uuid, uuid, text, uuid, text, uuid, text, uuid, boolean, uuid) from public, anon;
grant execute on function public.warehouse_adjust_stock(uuid, numeric, text, uuid, uuid, text, uuid, text, uuid, text, uuid, boolean, uuid) to authenticated, service_role;

-- ── 3. Check out ──────────────────────────────────────────────────

create or replace function public.warehouse_check_out(
  p_item_id uuid,
  p_quantity numeric,
  p_project_id uuid,
  p_employee_id uuid,
  p_notes text default null,
  p_performed_by uuid default null,
  p_performed_by_name text default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_id uuid := gen_random_uuid();
  v_name text;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;
  if p_project_id is null
     or not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Pick the job site it is going to';
  end if;

  select nullif(trim(concat_ws(' ', first_name, last_name)), '')
    into v_name
    from public.employees
   where id = p_employee_id;
  if v_name is null then
    raise exception 'Pick who is taking it';
  end if;

  perform public.warehouse_adjust_stock(
    p_item_id => p_item_id,
    p_change => -p_quantity,
    p_type => 'issue',
    p_project_id => p_project_id,
    p_notes => nullif(trim(p_notes), ''),
    p_performed_by => p_performed_by,
    p_performed_by_name => p_performed_by_name,
    p_employee_id => p_employee_id,
    p_employee_name => v_name,
    p_is_checkout => true,
    p_transaction_id => v_id
  );

  return v_id;
end;
$function$;

-- ── 4. Check in (partial returns allowed) ─────────────────────────

create or replace function public.warehouse_check_in(
  p_checkout_id uuid,
  p_quantity numeric,
  p_employee_id uuid,
  p_notes text default null,
  p_performed_by uuid default null,
  p_performed_by_name text default null
)
returns numeric
language plpgsql
set search_path to 'public'
as $function$
declare
  v_co public.warehouse_transactions%rowtype;
  v_returned numeric;
  v_outstanding numeric;
  v_name text;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity returned must be greater than zero';
  end if;

  -- Lock the checkout so two people checking the same thing in at once can't
  -- both return the last unit.
  select * into v_co
    from public.warehouse_transactions
   where id = p_checkout_id
     for update;

  if not found or not v_co.is_checkout then
    raise exception 'Checkout not found';
  end if;
  if v_co.checkout_closed_at is not null then
    raise exception 'This checkout is already closed';
  end if;

  select coalesce(sum(quantity_change), 0)
    into v_returned
    from public.warehouse_transactions
   where checkout_id = p_checkout_id;

  v_outstanding := -v_co.quantity_change - v_returned;
  if p_quantity > v_outstanding then
    raise exception 'Only % still out on this checkout', v_outstanding;
  end if;

  select nullif(trim(concat_ws(' ', first_name, last_name)), '')
    into v_name
    from public.employees
   where id = p_employee_id;
  if v_name is null then
    raise exception 'Pick who returned it';
  end if;

  perform public.warehouse_adjust_stock(
    p_item_id => v_co.item_id,
    p_change => p_quantity,
    p_type => 'return',
    p_project_id => v_co.project_id,
    p_notes => nullif(trim(p_notes), ''),
    p_performed_by => p_performed_by,
    p_performed_by_name => p_performed_by_name,
    p_employee_id => p_employee_id,
    p_employee_name => v_name,
    p_checkout_id => p_checkout_id
  );

  v_outstanding := v_outstanding - p_quantity;
  if v_outstanding <= 0 then
    update public.warehouse_transactions
       set checkout_closed_at = now(),
           checkout_close_reason = 'returned',
           checkout_closed_by = p_performed_by,
           checkout_closed_by_name = p_performed_by_name
     where id = p_checkout_id;
  end if;

  return greatest(v_outstanding, 0);
end;
$function$;

-- ── 5. Close a checkout as used on the job ────────────────────────
-- No stock moves: it already left the shelf at checkout. This just takes the
-- remainder off Out on Jobs. Returns the quantity written off.

create or replace function public.warehouse_close_checkout(
  p_checkout_id uuid,
  p_performed_by uuid default null,
  p_performed_by_name text default null
)
returns numeric
language plpgsql
set search_path to 'public'
as $function$
declare
  v_co public.warehouse_transactions%rowtype;
  v_returned numeric;
begin
  select * into v_co
    from public.warehouse_transactions
   where id = p_checkout_id
     for update;

  if not found or not v_co.is_checkout then
    raise exception 'Checkout not found';
  end if;
  if v_co.checkout_closed_at is not null then
    raise exception 'This checkout is already closed';
  end if;

  select coalesce(sum(quantity_change), 0)
    into v_returned
    from public.warehouse_transactions
   where checkout_id = p_checkout_id;

  update public.warehouse_transactions
     set checkout_closed_at = now(),
         checkout_close_reason = 'used',
         checkout_closed_by = p_performed_by,
         checkout_closed_by_name = p_performed_by_name
   where id = p_checkout_id;

  return -v_co.quantity_change - v_returned;
end;
$function$;

revoke all on function public.warehouse_check_out(uuid, numeric, uuid, uuid, text, uuid, text) from public, anon;
revoke all on function public.warehouse_check_in(uuid, numeric, uuid, text, uuid, text) from public, anon;
revoke all on function public.warehouse_close_checkout(uuid, uuid, text) from public, anon;
grant execute on function public.warehouse_check_out(uuid, numeric, uuid, uuid, text, uuid, text) to authenticated, service_role;
grant execute on function public.warehouse_check_in(uuid, numeric, uuid, text, uuid, text) to authenticated, service_role;
grant execute on function public.warehouse_close_checkout(uuid, uuid, text) to authenticated, service_role;

-- ── 6. Item photos ────────────────────────────────────────────────

alter table public.warehouse_items
  add column if not exists photo_path text,
  add column if not exists photo_thumb_path text;

comment on column public.warehouse_items.photo_path is
  'warehouse-photos bucket path of the item photo (~1600px long side JPEG). Null = no photo.';
comment on column public.warehouse_items.photo_thumb_path is
  'warehouse-photos bucket path of the small list thumbnail for photo_path.';

create or replace function public.can_manage_warehouse()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
           select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role in ('owner', 'precon_manager', 'office_admin')
         )
      or exists (
           select 1 from public.employees e
            where e.profile_id = auth.uid()
              and e.status = 'active'
              and e.title ~* '(warehouse|runner)'
         );
$function$;

revoke all on function public.can_manage_warehouse() from public, anon;
grant execute on function public.can_manage_warehouse() to authenticated, service_role;

-- The warehouse_items RLS policy is open to every signed-in user, so guard
-- the photo columns themselves. Service-role writes (auth.uid() is null) pass.
create or replace function public.warehouse_items_guard_photo()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_changed := new.photo_path is not null or new.photo_thumb_path is not null;
  else
    v_changed := new.photo_path is distinct from old.photo_path
              or new.photo_thumb_path is distinct from old.photo_thumb_path;
  end if;

  if v_changed and auth.uid() is not null and not public.can_manage_warehouse() then
    raise exception 'Only warehouse staff and admins can change item photos';
  end if;
  return new;
end;
$function$;

drop trigger if exists warehouse_items_guard_photo on public.warehouse_items;
create trigger warehouse_items_guard_photo
  before insert or update of photo_path, photo_thumb_path on public.warehouse_items
  for each row execute function public.warehouse_items_guard_photo();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'warehouse-photos',
  'warehouse-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "Staff can view warehouse photos" on storage.objects;
drop policy if exists "Warehouse managers can upload warehouse photos" on storage.objects;
drop policy if exists "Warehouse managers can update warehouse photos" on storage.objects;
drop policy if exists "Warehouse managers can delete warehouse photos" on storage.objects;

create policy "Staff can view warehouse photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'warehouse-photos');

create policy "Warehouse managers can upload warehouse photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'warehouse-photos' and public.can_manage_warehouse());

create policy "Warehouse managers can update warehouse photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'warehouse-photos' and public.can_manage_warehouse())
  with check (bucket_id = 'warehouse-photos' and public.can_manage_warehouse());

create policy "Warehouse managers can delete warehouse photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'warehouse-photos' and public.can_manage_warehouse());

-- ── 7. Out on Jobs ────────────────────────────────────────────────

create or replace view public.warehouse_open_checkouts
with (security_invoker = true)
as
select
  t.id,
  t.item_id,
  i.name as item_name,
  i.sku,
  i.unit,
  i.location,
  i.barcode,
  i.photo_thumb_path,
  t.project_id,
  p.name as project_name,
  p.project_number,
  t.employee_id,
  t.employee_name,
  -t.quantity_change as quantity_out,
  coalesce(r.returned, 0) as quantity_returned,
  -t.quantity_change - coalesce(r.returned, 0) as quantity_outstanding,
  t.created_at as checked_out_at,
  t.performed_by_name,
  t.notes
from public.warehouse_transactions t
join public.warehouse_items i on i.id = t.item_id
left join public.projects p on p.id = t.project_id
left join lateral (
  select sum(x.quantity_change) as returned
    from public.warehouse_transactions x
   where x.checkout_id = t.id
) r on true
where t.is_checkout
  and t.checkout_closed_at is null;

revoke all on public.warehouse_open_checkouts from anon;
grant select on public.warehouse_open_checkouts to authenticated, service_role;
