begin;
select set_config('request.jwt.claim.sub',(select id::text from profiles where role='owner' limit 1),true);
select set_config('request.jwt.claim.role','authenticated',true);
do $test$
declare i invoices%rowtype; b uuid;
begin
  select * into i from invoices where id='b6189c0e-4989-4859-a30e-e46c23af63bb';
  i.id:=gen_random_uuid();i.estimate_line_item_id:=null;i.amount:=43.17;i.paid_amount:=43.17;
  i.created_by:=auth.uid();i.quickbooks_id:=null;i.quickbooks_purchase_id:=null;i.quickbooks_bill_id:=null;
  i.invoice_date:=current_date;i.paid_date:=current_date;i.work_date:=current_date;i.split_group_id:=null;
  insert into invoices select i.*;
  perform set_config('test.invoice_id',i.id::text,true);
  select id into b from bank_transactions limit 1;
  insert into bank_transaction_matches(bank_transaction_id,invoice_id,amount_applied,confidence) values(b,i.id,20,'manual');
  select id into b from bank_transactions where id<>b limit 1;
  insert into bank_transaction_matches(bank_transaction_id,invoice_id,amount_applied,confidence) values(b,i.id,23.17,'manual');
end $test$;
set local role authenticated;
do $test$
declare original invoices%rowtype; parts jsonb; ids uuid[]; before_count int; rejected boolean;
begin
  select * into original from invoices where id=current_setting('test.invoice_id')::uuid;
  if not found then raise exception 'Fixture inaccessible under RLS'; end if;
  parts:=jsonb_build_array(jsonb_build_object('project_id',original.project_id,'amount',10.01,'note','Fire caulk'),jsonb_build_object('project_id',original.project_id,'amount',33.16,'note','Other receipt items'));
  select array_agg(id) into ids from split_spend_invoice(original.id,parts);
  if cardinality(ids)<>2 or not original.id=any(ids) then raise exception 'Original ID lost'; end if;
  if (select sum(amount) from invoices where id=any(ids))<>43.17 or (select sum(paid_amount) from invoices where id=any(ids))<>43.17 then raise exception 'Invoice totals changed';end if;
  if (select count(*) from invoices where id=any(ids) and attachment_storage_path=original.attachment_storage_path and account_id is not distinct from original.account_id)<>2 then raise exception 'Source or account lost';end if;
  if (select sum(amount_applied) from bank_transaction_matches where invoice_id=any(ids))<>43.17 then raise exception 'Matches lost';end if;
  if exists(select 1 from invoices i where id=any(ids) and paid_amount<>(select sum(amount_applied) from bank_transaction_matches m where m.invoice_id=i.id)) then raise exception 'Partial payment rounding mismatch';end if;
  rejected:=false;
  begin perform split_spend_invoice(original.id,jsonb_build_array(jsonb_build_object('project_id',original.project_id,'amount',5),jsonb_build_object('project_id',original.project_id,'amount',5)));exception when others then rejected:=true;end;
  if not rejected then raise exception 'Accepted one-cent mismatch';end if;
  rejected:=false;
  begin perform split_spend_invoice(original.id,jsonb_build_array(jsonb_build_object('project_id',original.project_id,'amount',11.01),jsonb_build_object('project_id',original.project_id,'amount',-1)));exception when others then rejected:=true;end;
  if not rejected then raise exception 'Accepted mixed signs';end if;
end $test$;
reset role;
rollback;
