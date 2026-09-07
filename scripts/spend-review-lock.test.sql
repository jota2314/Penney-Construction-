-- Run against a populated development database. Every change rolls back.
begin;
select set_config('request.jwt.claim.sub',
  (select id::text from public.profiles where role::text = 'owner' limit 1), true);
set local role authenticated;
do $$
declare
  inv public.invoices%rowtype;
  target uuid;
  n integer;
begin
  select i.* into inv from public.invoices i
  where i.project_id is not null and i.estimate_line_item_id is not null
    and exists (select 1 from public.estimate_line_items l
      join public.estimates e on e.id=l.estimate_id
      where e.project_id=i.project_id and l.id<>i.estimate_line_item_id
        and not coalesce(l.is_section_header,false)) limit 1;
  if inv.id is null then raise exception 'Test needs an invoice and two budget lines'; end if;
  select l.id into target from public.estimate_line_items l
    join public.estimates e on e.id=l.estimate_id
    where e.project_id=inv.project_id and l.id<>inv.estimate_line_item_id
      and not coalesce(l.is_section_header,false) limit 1;
  update public.estimate_line_items set is_locked=true, closed_price=1000,
    closed_labor_cost=10 where id in(target,inv.estimate_line_item_id);
  begin
    update public.invoices set estimate_line_item_id=target where id=inv.id;
    raise exception 'Ordinary assignment bypassed lock';
  exception when check_violation then null;
  end;
  n:=public.confirm_spend_review(array[inv.id],jsonb_build_object('estimate_line_item_id',target));
  if n<>1 or not exists(select 1 from public.invoices where id=inv.id
    and estimate_line_item_id=target and review_status='ok' and help_resolved_by=auth.uid())
    then raise exception 'Review did not resolve'; end if;
  if exists(select 1 from public.estimate_line_items l where id in(target,inv.estimate_line_item_id)
    and (not is_locked or closed_invoice_cost is distinct from
      (select coalesce(sum(amount),0) from public.invoices where estimate_line_item_id=l.id)
      or closed_margin is distinct from (closed_price-closed_invoice_cost-closed_labor_cost)))
    then raise exception 'Lock or closeout was not preserved'; end if;
  begin
    perform public.confirm_spend_review(array[inv.id],jsonb_build_object('project_id',null));
    raise exception 'Invalid job accepted';
  exception when raise_exception then
    if sqlerrm<>'Pick a job first' then raise; end if;
  end;
  n:=public.confirm_spend_review(array[inv.id,inv.id],jsonb_build_object('estimate_line_item_id',inv.estimate_line_item_id));
  if n<>1 then raise exception 'Batch did not deduplicate IDs'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.confirm_spend_review(array[inv.id],'{}');
    raise exception 'Unauthenticated call accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
