begin;
select set_config('request.jwt.claim.sub',(select id::text from profiles where role::text='owner' limit 1),true);
set local role authenticated;
do $test$
declare fixture uuid; fan uuid; permit uuid; ids uuid[]; before_paid numeric; before_matches numeric; parts jsonb;
begin
 update estimate_line_items set is_locked=true where id='74d18afb-e9a8-4a33-8be8-c0560ddbfc72';
 insert into invoices(vendor_name,amount,paid_amount,payment_status,project_id,invoice_date,created_by,review_status)
 values('Closed split rollback test',228.40,228.40,'paid','71762b11-b7c6-4416-b36e-217e44c80792',current_date,auth.uid(),'needs_review') returning id into fixture;
 select l.id into fan from estimate_line_items l where l.estimate_id=current_estimate_id('71762b11-b7c6-4416-b36e-217e44c80792') and l.description='Exhaust Fan — Supply, Vent & Install' limit 1;
 select id into permit from estimate_line_items where id='74d18afb-e9a8-4a33-8be8-c0560ddbfc72' and is_locked;
 if fan is null or permit is null then raise exception 'Expected screenshot lines not found'; end if;
 select paid_amount into before_paid from invoices where id=fixture;
 select coalesce(sum(amount_applied),0) into before_matches from bank_transaction_matches where invoice_id=fixture;
 parts:=jsonb_build_array(
 jsonb_build_object('project_id','71762b11-b7c6-4416-b36e-217e44c80792','line_item_id',fan,'amount',79.58),
 jsonb_build_object('project_id','71762b11-b7c6-4416-b36e-217e44c80792','line_item_id',fan,'amount',61.77),
 jsonb_build_object('project_id','71762b11-b7c6-4416-b36e-217e44c80792','line_item_id',permit,'amount',45.66),
 jsonb_build_object('project_id','71762b11-b7c6-4416-b36e-217e44c80792','line_item_id',permit,'amount',24.40),
 jsonb_build_object('project_id','71762b11-b7c6-4416-b36e-217e44c80792','line_item_id',fan,'amount',16.99));
 select array_agg(id) into ids from split_spend_invoice(fixture,parts);
 if cardinality(ids)<>5 or (select sum(amount) from invoices where id=any(ids))<>228.40 then raise exception 'Split amount changed'; end if;
 if (select sum(paid_amount) from invoices where id=any(ids))<>before_paid then raise exception 'Payment changed'; end if;
 if (select coalesce(sum(amount_applied),0) from bank_transaction_matches where invoice_id=any(ids))<>before_matches then raise exception 'Matches changed'; end if;
 if not exists(select 1 from estimate_line_items l where id=permit and is_locked and closed_invoice_cost=(select coalesce(sum(amount),0) from invoices where estimate_line_item_id=permit)) then raise exception 'Closed status/snapshot lost'; end if;
 if (select count(*) from invoices where id=any(ids) and review_status='ok')<>5 then raise exception 'Pieces not confirmed'; end if;
end $test$;
rollback;
