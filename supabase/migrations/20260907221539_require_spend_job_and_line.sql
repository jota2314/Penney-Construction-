-- Office review is an explicit manual correction, including closed lines.
-- Keep the ordinary posting guard. Unlock only inside this transaction, then
-- restore locks and refresh the invoice portion of each closeout snapshot.
create or replace function public.confirm_spend_review(p_invoice_ids uuid[], p_updates jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ids uuid[];
  v_lines uuid[];
  v_locked uuid[];
  v_count integer;
  v_row record;
  v_project uuid;
  v_line uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from profiles where id = auth.uid()
      and role::text in ('owner', 'office_admin', 'precon_manager')
  ) then
    raise exception 'Office access required' using errcode = '42501';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_invoice_ids) x where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'Nothing selected'; end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
    raise exception 'Invalid review update';
  end if;
  perform id from invoices where id = any(v_ids) order by id for update;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_ids) then raise exception 'Transaction not found or not editable'; end if;

  for v_row in select id, project_id, estimate_line_item_id from invoices where id = any(v_ids) loop
    v_project := case when p_updates ? 'project_id' then (p_updates->>'project_id')::uuid else v_row.project_id end;
    v_line := case when p_updates ? 'estimate_line_item_id' then (p_updates->>'estimate_line_item_id')::uuid else v_row.estimate_line_item_id end;
    if v_project is null then raise exception 'Pick a job first'; end if;
    if v_line is null then raise exception 'Pick a budget line before confirming'; end if;
    if not exists (
      select 1 from estimate_line_items l join estimates e on e.id = l.estimate_id
      where l.id = v_line and e.project_id = v_project and not coalesce(l.is_section_header, false)
    ) then raise exception 'The budget line does not belong to the selected job'; end if;
  end loop;
  if p_updates ? 'amount' and ((p_updates->>'amount')::numeric is null or (p_updates->>'amount')::numeric = 0) then
    raise exception 'Amount cannot be zero or empty';
  end if;

  select array_agg(distinct line_id) into v_lines from (
    select estimate_line_item_id as line_id from invoices where id = any(v_ids)
    union select (p_updates->>'estimate_line_item_id')::uuid
  ) candidates where line_id is not null;
  perform id from estimate_line_items where id = any(v_lines) order by id for update;
  select array_agg(id) into v_locked from estimate_line_items where id = any(v_lines) and is_locked;
  update estimate_line_items set is_locked = false where id = any(v_locked);

  update invoices set
    project_id = case when p_updates ? 'project_id' then (p_updates->>'project_id')::uuid else project_id end,
    estimate_line_item_id = case when p_updates ? 'estimate_line_item_id' then (p_updates->>'estimate_line_item_id')::uuid else estimate_line_item_id end,
    vendor_name = coalesce(nullif(btrim(p_updates->>'vendor_name'), ''), vendor_name),
    amount = case when p_updates ? 'amount' then (p_updates->>'amount')::numeric else amount end,
    paid_amount = case when p_updates ? 'paid_amount' then (p_updates->>'paid_amount')::numeric else paid_amount end,
    review_status = 'ok', review_reason = null,
    help_resolved_at = now(), help_resolved_by = auth.uid()
  where id = any(v_ids);
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_ids) then raise exception 'Transaction not editable'; end if;

  update estimate_line_items l set
    is_locked = true,
    closed_invoice_cost = (select coalesce(sum(i.amount), 0) from invoices i where i.estimate_line_item_id = l.id),
    closed_margin = l.closed_price - coalesce(l.closed_labor_cost, 0)
      - (select coalesce(sum(i.amount), 0) from invoices i where i.estimate_line_item_id = l.id)
  where l.id = any(v_locked);
  return v_count;
end;
$$;
revoke all on function public.confirm_spend_review(uuid[], jsonb) from public, anon;
grant execute on function public.confirm_spend_review(uuid[], jsonb) to authenticated;


-- Capture/import can save an incomplete cost, but must keep it in review.
create or replace function public.keep_unallocated_spend_in_review()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.duplicate_of_id is null and
     (new.project_id is null or new.estimate_line_item_id is null) then
    if tg_op = 'UPDATE' and new.review_status = 'ok' and
       (old.review_status is distinct from new.review_status or
        new.help_resolved_at is distinct from old.help_resolved_at) then
      raise exception 'Choose a job and budget line before confirming' using errcode = '23514';
    end if;
    new.review_status := 'needs_review';
    new.review_reason := coalesce(nullif(new.review_reason,''),
      case when new.project_id is null then 'Choose a job and budget line before confirming.'
           else 'Choose a budget line before confirming.' end);
  end if;
  return new;
end $$;
create trigger trg_keep_unallocated_spend_in_review
before insert or update on public.invoices
for each row execute function public.keep_unallocated_spend_in_review();

-- Preserve amounts, payments, job assignments, and prior confirmation evidence.
update public.invoices
set review_status = 'needs_review',
    review_reason = concat_ws(E'\n', nullif(review_reason,''),
      case when project_id is null then 'Reopened: choose a job and budget line before confirming.'
           else 'Reopened: choose a budget line before confirming.' end)
where duplicate_of_id is null and review_status = 'ok'
  and (project_id is null or estimate_line_item_id is null);

alter table public.invoices add constraint invoices_review_requires_allocation
check (duplicate_of_id is not null or review_status <> 'ok' or
       (project_id is not null and estimate_line_item_id is not null));
