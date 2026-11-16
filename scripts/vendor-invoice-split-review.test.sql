-- Regression test for office bill uploads: splitting must not clear a hold.
-- All fixtures and splits are rolled back; no existing invoice is modified.
begin;
do $test$
declare
  parent_id uuid;
  child_id uuid;
  child_group uuid;
  ids uuid[];
  scenario record;
begin
  for scenario in
    select * from (values
      ('needs_review', 'looks like the SAME bill already in the books'),
      ('needs_review', 'this looks like a QUOTE, not a bill'),
      ('needs_review', null),
      ('ok', null)
    ) as cases(status, reason)
  loop
    insert into public.invoices
      (vendor_name, vendor_type, amount, paid_amount, payment_status,
       invoice_date, source, review_status, review_reason)
    values
      ('SPLIT REVIEW REGRESSION TEST', 'supplier', 100, 33.33, 'partial',
       current_date, 'office_entry', scenario.status, scenario.reason)
    returning id into parent_id;

    select array_agg(id) into ids from public.split_vendor_invoice(parent_id,
      '[{"amount":20,"note":"Footings"},{"amount":30,"note":"Framing"},{"amount":50,"note":"Decking"}]'::jsonb);
    if cardinality(ids) <> 3 then raise exception 'Expected three allocations'; end if;
    if exists (select 1 from public.invoices where id = parent_id) then
      raise exception 'Parent was not replaced';
    end if;
    if exists (select 1 from public.invoices where id = any(ids) and
      (review_status is distinct from scenario.status or review_reason is distinct from scenario.reason)) then
      raise exception 'Split lost review hold: % / %', scenario.status, scenario.reason;
    end if;
    if (select sum(amount) from public.invoices where id = any(ids)) <> 100
      or (select sum(paid_amount) from public.invoices where id = any(ids)) <> 33.33 then
      raise exception 'Split changed invoice or payment total';
    end if;
    if (select count(distinct split_group_id) from public.invoices where id = any(ids)) <> 1 then
      raise exception 'Allocations must share a split group';
    end if;

    select id, split_group_id into child_id, child_group from public.invoices
      where id = any(ids) and amount = 20;
    perform public.split_vendor_invoice(child_id, '[{"amount":8},{"amount":12}]'::jsonb);
    if (select count(*) from public.invoices where split_group_id = child_group) <> 4
      or exists (select 1 from public.invoices where split_group_id = child_group and
        (review_status is distinct from scenario.status or review_reason is distinct from scenario.reason)) then
      raise exception 'Re-splitting lost review hold or split group';
    end if;
    if (select sum(amount) from public.invoices where split_group_id = child_group) <> 100
      or (select sum(paid_amount) from public.invoices where split_group_id = child_group) <> 33.33 then
      raise exception 'Re-splitting changed invoice or payment total';
    end if;
  end loop;
end;
$test$;
rollback;
