-- Reviewed client charge ledger. Does not create bills, invoices, payments or wages.
alter table public.change_orders
  add column billing_type text not null default 'fixed_price'
    check (billing_type in ('fixed_price','time_materials')),
  add column tm_terms text,
  -- Durable authorization history: rejecting/voiding never makes issued scope editable.
  add column tm_issued_at timestamptz;

create function public.can_manage_time_materials(p_project_id uuid)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles u join public.projects p on p.id=p_project_id
    where u.id=auth.uid() and (
      u.role in ('owner','precon_manager','office_admin')
      or (u.role='project_manager' and p.assigned_pm=u.id)
    )
  );
$$;
revoke all on function public.can_manage_time_materials(uuid) from public,anon;
grant execute on function public.can_manage_time_materials(uuid) to authenticated,service_role;

create table public.change_order_tm_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  change_order_id uuid not null references public.change_orders(id) on delete restrict,
  work_date date not null,
  category text not null check (category in ('labor','material','equipment','other')),
  description text not null check (length(btrim(description)) between 1 and 2000),
  quantity numeric(14,4) not null check (quantity > 0 and quantity <= 1000000),
  unit text not null check (length(btrim(unit)) between 1 and 30),
  unit_rate numeric(14,4) check (unit_rate >= 0 and unit_rate <= 10000000),
  amount numeric generated always as (round(quantity * unit_rate,2)) stored,
  source_daily_log_id uuid references public.daily_logs(id) on delete restrict,
  source_invoice_id uuid references public.invoices(id) on delete restrict,
  -- Internal source version/facts; NEVER selected into the client portal payload.
  source_snapshot jsonb,
  status text not null default 'draft' check (status in ('draft','published','void')),
  published_at timestamptz,
  published_by uuid references auth.users(id),
  void_reason text,
  created_by uuid not null references auth.users(id) default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  check (num_nonnulls(source_daily_log_id,source_invoice_id)<=1),
  check (status<>'published' or (unit_rate is not null and published_at is not null and published_by is not null)),
  check (status<>'void' or length(btrim(void_reason)) between 3 and 2000)
);
create index change_order_tm_project_co on public.change_order_tm_entries(project_id,change_order_id,work_date,id);
create index change_order_tm_published on public.change_order_tm_entries(change_order_id,work_date,id)
  where published_at is not null;
-- One whole source per active charge. Split vendor bills through their existing workflow.
create unique index change_order_tm_unique_log on public.change_order_tm_entries(source_daily_log_id)
  where source_daily_log_id is not null and status<>'void';
create unique index change_order_tm_unique_invoice on public.change_order_tm_entries(source_invoice_id)
  where source_invoice_id is not null and status<>'void';

alter table public.change_order_tm_entries enable row level security;
revoke all on public.change_order_tm_entries from public,anon,authenticated,service_role;
grant select,insert,update on public.change_order_tm_entries to authenticated;
grant select on public.change_order_tm_entries to service_role;
create policy tm_entries_read on public.change_order_tm_entries for select to authenticated
  using (public.can_manage_time_materials(project_id));
create policy tm_entries_insert on public.change_order_tm_entries for insert to authenticated
  with check (public.can_manage_time_materials(project_id));
create policy tm_entries_update on public.change_order_tm_entries for update to authenticated
  using (public.can_manage_time_materials(project_id))
  with check (public.can_manage_time_materials(project_id));

create function public.guard_time_material_entry()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare co public.change_orders%rowtype; source jsonb; source_project uuid; source_co uuid;
begin
  if not public.can_manage_time_materials(new.project_id) then
    raise exception 'Not allowed to manage this project''s time and materials.' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    if new.id<>old.id or new.project_id<>old.project_id or new.change_order_id<>old.change_order_id
      or new.created_by<>old.created_by or new.created_at<>old.created_at then
      raise exception 'Entry identity and provenance cannot change.';
    end if;
    if old.status='void' then raise exception 'Voided entries are immutable.'; end if;
    if old.status='published' or new.status='void' then
      if new.status<>'void' or length(btrim(coalesce(new.void_reason,''))) not between 3 and 2000 then
        raise exception 'Published entries are immutable; void with a reason and add a replacement.';
      end if;
      if row(new.work_date,new.category,new.description,new.quantity,new.unit,new.unit_rate,
             new.source_daily_log_id,new.source_invoice_id,new.source_snapshot,new.published_at,new.published_by)
         is distinct from
         row(old.work_date,old.category,old.description,old.quantity,old.unit,old.unit_rate,
             old.source_daily_log_id,old.source_invoice_id,old.source_snapshot,old.published_at,old.published_by) then
        raise exception 'Voiding preserves the original charge and publication history.';
      end if;
      new.updated_at:=clock_timestamp(); new.updated_by:=auth.uid();
      return new;
    end if;
  elsif new.status<>'draft' then
    raise exception 'Save a draft for review before publishing.';
  end if;

  select * into co from public.change_orders where id=new.change_order_id for share;
  if not found or co.project_id is distinct from new.project_id then raise exception 'Change order does not belong to this project.'; end if;
  if co.billing_type<>'time_materials' or co.status in ('rejected','void') then
    raise exception 'An active time-and-materials change order is required.';
  end if;

  -- Source facts are read under locks so validation and save/publish are one transaction.
  if new.source_daily_log_id is not null then
    select to_jsonb(d) - 'text' - 'photo_storage_paths',
      coalesce(d.project_id,p.project_id),li.change_order_id
      into source,source_project,source_co
    from public.daily_logs d left join public.schedule_phases p on p.id=d.schedule_phase_id
    left join public.estimate_line_items li on li.id=coalesce(d.estimate_line_item_id,p.estimate_line_item_id)
    where d.id=new.source_daily_log_id and d.kind is distinct from 'post'
      and d.author_id is not null and d.ended_at is not null and d.ended_at>d.started_at
      and d.status='completed' and not coalesce(d.line_item_needs_review,false)
    for share of d;
    if source is null or source_project is distinct from new.project_id or source_co is distinct from co.id then
      raise exception 'Choose a completed, reviewed labor record allocated to this change order.';
    end if;
    if new.category<>'labor' then raise exception 'Labor evidence requires the labor category.'; end if;
  elsif new.source_invoice_id is not null then
    select jsonb_build_object('id',i.id,'project_id',i.project_id,'change_order_id',i.change_order_id,
      'estimate_line_item_id',i.estimate_line_item_id,'invoice_date',i.invoice_date,
      'amount',i.amount,'description',i.description,'duplicate_of_id',i.duplicate_of_id,
      'review_status',i.review_status,'updated_at',i.updated_at),i.project_id,coalesce(i.change_order_id,li.change_order_id)
      into source,source_project,source_co
    from public.invoices i left join public.estimate_line_items li on li.id=i.estimate_line_item_id
    where i.id=new.source_invoice_id and i.duplicate_of_id is null
      and (i.review_status is null or i.review_status='ok')
    for share of i;
    if source is null or source_project is distinct from new.project_id or source_co is distinct from co.id then
      raise exception 'Choose a reviewed bill allocated to this change order.';
    end if;
  end if;
  if new.status='published' then
    if new.unit_rate is null then raise exception 'Enter the agreed client rate before publishing.'; end if;
    if co.status not in ('submitted','approved') or nullif(btrim(co.tm_terms),'') is null then
      raise exception 'Submit or approve the T&M terms before publishing charges.';
    end if;
    if source is distinct from old.source_snapshot then
      raise exception 'Source evidence changed. Review and save this draft again before publishing.';
    end if;
    new.published_at:=clock_timestamp(); new.published_by:=auth.uid();
  else
    new.published_at:=null; new.published_by:=null;
  end if;
  new.source_snapshot:=source; new.void_reason:=null;
  if tg_op='INSERT' then new.created_by:=auth.uid(); new.created_at:=clock_timestamp(); end if;
  new.updated_by:=auth.uid(); new.updated_at:=clock_timestamp();
  return new;
end;
$$;
revoke all on function public.guard_time_material_entry() from public,anon,authenticated,service_role;
create trigger guard_time_material_entry before insert or update on public.change_order_tm_entries
  for each row execute function public.guard_time_material_entry();

create function public.guard_change_order_tm_terms()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op='INSERT' and new.billing_type='time_materials'
    and not public.can_manage_time_materials(new.project_id) then
    raise exception 'Only the office and assigned project manager can create T&M billing terms.' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    if ((new.billing_type,new.tm_terms) is distinct from (old.billing_type,old.tm_terms)
      or (old.billing_type='time_materials' and (new.title,new.description) is distinct from (old.title,old.description)))
      and not public.can_manage_time_materials(new.project_id) then
      raise exception 'Only the office and assigned project manager can change billing terms.' using errcode='42501';
    end if;
    if old.billing_type='time_materials' and new.project_id is distinct from old.project_id then
      raise exception 'A T&M change order cannot be moved to a different project.';
    end if;
    if old.billing_type='time_materials' and old.tm_issued_at is not null
      and new.tm_issued_at is distinct from old.tm_issued_at then
      raise exception 'Issued T&M authorization history cannot be changed or cleared.';
    end if;
    if old.billing_type='time_materials' and old.approved_at is not null and new.approved_at is null then
      raise exception 'T&M approval history cannot be cleared.';
    end if;
    if old.billing_type='time_materials'
      and (old.tm_issued_at is not null or old.approved_at is not null
        or old.status in ('submitted','approved') or old.sent_to_client_at is not null or old.client_signed_at is not null)
      and (new.status='draft' or (old.sent_to_client_at is not null and new.sent_to_client_at is null)
        or (old.client_signed_at is not null and new.client_signed_at is null)
        or (old.client_signature is not null and new.client_signature is null)) then
      raise exception 'Issued T&M authorization cannot be reset to an editable draft; void and create a new change order.';
    end if;
    if ((new.billing_type,new.tm_terms) is distinct from (old.billing_type,old.tm_terms)
      or (old.billing_type='time_materials' and (new.title,new.description) is distinct from (old.title,old.description)))
      and (old.tm_issued_at is not null or old.approved_at is not null
        or old.sent_to_client_at is not null or old.client_signed_at is not null
        or old.client_signature is not null or old.status in ('submitted','approved')) then
      raise exception 'Issued or approved change-order scope and billing terms cannot change; create a new change order.';
    end if;
    if old.billing_type='time_materials' and new.billing_type<>'time_materials'
      and exists(select 1 from public.change_order_tm_entries where change_order_id=old.id) then
      raise exception 'A change order with T&M ledger history cannot become fixed price.';
    end if;
    if row(new.title,new.description,new.billing_type,new.tm_terms,new.price_impact,new.status)
      is distinct from row(old.title,old.description,old.billing_type,old.tm_terms,old.price_impact,old.status) then
      new.updated_at:=clock_timestamp();
    end if;
  end if;
  if new.billing_type='time_materials' then
    if new.price_impact is distinct from 0::numeric then
      raise exception 'T&M charges belong in the ledger, not the fixed contract price.';
    end if;
    if (new.status in ('submitted','approved') or new.sent_to_client_at is not null
      or new.client_signed_at is not null) and nullif(btrim(new.tm_terms),'') is null then
      raise exception 'Document the agreed time-and-materials billing terms before issuing or approving.';
    end if;
    if tg_op='INSERT' then new.tm_issued_at:=null;
    elsif old.tm_issued_at is null then new.tm_issued_at:=null;
    end if;
    if new.tm_issued_at is null and (new.status in ('submitted','approved')
      or new.sent_to_client_at is not null or new.client_signed_at is not null
      or new.client_signature is not null or new.approved_at is not null) then
      new.tm_issued_at:=clock_timestamp();
    end if;
    if new.status='approved' and new.approved_at is null then new.approved_at:=clock_timestamp(); end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_change_order_tm_terms() from public,anon,authenticated,service_role;
create trigger guard_change_order_tm_terms before insert or update on public.change_orders
  for each row execute function public.guard_change_order_tm_terms();
