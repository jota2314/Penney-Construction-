-- Execute with the migration in the same BEGIN/ROLLBACK transaction.
do $$
declare
  actor uuid; job uuid; other_job uuid; invoice uuid; other_invoice uuid;
  receipt uuid; second_receipt uuid; oversized uuid; unreviewed uuid; result jsonb;
begin
  select id into actor from profiles where role='owner' order by id limit 1;
  select id into job from projects order by id limit 1;
  select id into other_job from projects where id<>job order by id limit 1;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into client_invoices(project_id,invoice_number,title,amount,status,created_by)
    values(job,2147000000,'Rollback-only receipt test',100,'sent',actor) returning id into invoice;
  insert into client_invoices(project_id,invoice_number,title,amount,status,created_by)
    values(other_job,2147000000,'Rollback-only other project',100,'sent',actor) returning id into other_invoice;
  insert into payments_received(project_id,payment_type,amount,received_date,review_status,created_by)
    values(job,'draw',40,'2026-09-10','ok',actor) returning id into receipt;
  insert into payments_received(project_id,payment_type,amount,received_date,review_status,created_by)
    values(job,'draw',60,'2026-09-11','ok',actor) returning id into second_receipt;
  insert into payments_received(project_id,payment_type,amount,received_date,review_status,created_by)
    values(job,'draw',101,'2026-09-11','ok',actor) returning id into oversized;
  insert into payments_received(project_id,payment_type,amount,received_date,review_status,created_by)
    values(job,'draw',20,'2026-09-11','needs_review',actor) returning id into unreviewed;
  begin
    update client_invoices set status='paid',paid_amount=100 where id=invoice;
    raise exception 'TEST FAILED: status-only update accepted';
  exception when others then
    if sqlerrm not like 'Apply the actual receipt%' then raise; end if;
  end;
  begin
    perform apply_client_invoice_receipt(other_invoice,other_job,receipt);
    raise exception 'TEST FAILED: cross-project receipt accepted';
  exception when others then
    if sqlerrm not like 'Choose a positive receipt%' then raise; end if;
  end;
  begin
    perform apply_client_invoice_receipt(invoice,job,oversized);
    raise exception 'TEST FAILED: overpayment accepted';
  exception when others then
    if sqlerrm not like 'Receipts exceed%' then raise; end if;
  end;
  if (select client_invoice_id from payments_received where id=oversized) is not null then raise exception 'TEST FAILED: failed allocation persisted'; end if;
  begin
    perform apply_client_invoice_receipt(invoice,job,unreviewed);
    raise exception 'TEST FAILED: unreviewed receipt accepted';
  exception when others then
    if sqlerrm not like 'Review this receipt%' then raise; end if;
  end;
  result := apply_client_invoice_receipt(invoice,job,receipt);
  if result->>'status'<>'sent' or (result->>'paid_amount')::numeric<>40 then raise exception 'TEST FAILED: partial receipt'; end if;
  result := apply_client_invoice_receipt(invoice,job,receipt);
  if (result->>'paid_amount')::numeric<>40 then raise exception 'TEST FAILED: retry doubled receipt'; end if;
  result := apply_client_invoice_receipt(invoice,job,second_receipt);
  if result->>'status'<>'paid' or (result->>'paid_amount')::numeric<>100 then raise exception 'TEST FAILED: full receipt'; end if;
  if (select paid_at::date from client_invoices where id=invoice)<>'2026-09-11'::date then raise exception 'TEST FAILED: receipt date changed'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform apply_client_invoice_receipt(invoice,job,receipt);
    raise exception 'TEST FAILED: anonymous accepted';
  exception when others then
    if sqlerrm not like 'You do not have access%' then raise; end if;
  end;
end;
$$;
select 'receipt allocation scenarios passed; all fixtures rolled back' as result;
