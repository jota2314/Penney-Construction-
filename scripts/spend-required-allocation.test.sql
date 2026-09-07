-- Every fixture and confirmation rolls back. No external calls.
begin;
select set_config('request.jwt.claim.sub',
  (select id::text from public.profiles where role::text='owner' limit 1), true);
set local role authenticated;
do $$
declare
  a uuid; b uuid; job uuid; line uuid; n integer;
begin
  select e.project_id,l.id into job,line from public.estimate_line_items l
  join public.estimates e on e.id=l.estimate_id
  where not coalesce(l.is_section_header,false) limit 1;
  if line is null then raise exception 'Test needs a budget line'; end if;
  insert into public.invoices(vendor_name,amount,invoice_date,created_by,review_status)
    values('Allocation guard test',10,current_date,auth.uid(),'needs_review') returning id into a;
  begin
    perform public.confirm_spend_review(array[a],'{}');
    raise exception 'Missing job accepted';
  exception when raise_exception then
    if sqlerrm<>'Pick a job first' then raise; end if;
  end;
  begin
    perform public.confirm_spend_review(array[a],jsonb_build_object('project_id',job));
    raise exception 'Missing line accepted';
  exception when raise_exception then
    if sqlerrm<>'Pick a budget line before confirming' then raise; end if;
  end;
  begin
    update public.invoices set review_status='ok' where id=a;
    raise exception 'Direct confirmation bypassed the rule';
  exception when check_violation then null;
  end;
  insert into public.invoices(vendor_name,amount,invoice_date,project_id,created_by,review_status)
    values('Allocation guard credit test',-10,current_date,job,auth.uid(),'needs_review') returning id into b;
  n:=public.confirm_spend_review(array[a],jsonb_build_object('project_id',job,'estimate_line_item_id',line));
  if n<>1 then raise exception 'Valid confirmation failed'; end if;
  begin
    perform public.confirm_spend_review(array[a,b],'{}');
    raise exception 'Mixed incomplete batch accepted';
  exception when raise_exception then
    if sqlerrm<>'Pick a budget line before confirming' then raise; end if;
  end;
  if not exists(select 1 from public.invoices where id=b and review_status='needs_review')
    then raise exception 'Failed batch changed incomplete row'; end if;
  n:=public.confirm_spend_review(array[a,b],jsonb_build_object('project_id',job,'estimate_line_item_id',line));
  if n<>2 or (select count(*) from public.invoices where id in(a,b) and review_status='ok')<>2
    then raise exception 'Valid batch/credit failed'; end if;
  if (select sum(amount) from public.invoices where id in(a,b))<>0
    then raise exception 'Confirmation changed money'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.confirm_spend_review(array[a],'{}');
    raise exception 'Anonymous confirmation accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
