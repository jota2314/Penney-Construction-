import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = uid(1), crew = uid(2), job = uid(3), estimate = uid(4), line = uid(5);
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth to authenticated,anon,service_role;
  grant execute on function auth.uid() to authenticated,anon,service_role;
  -- Match hosted default ACLs, including service-role grants, so the migration
  -- must explicitly remove them from the immutable audit table.
  alter default privileges in schema public grant all on tables to service_role;
`);
await db.exec(read('job-review-test-schema.sql'));
await db.exec(`
  create table public.project_finance_records(id uuid primary key default gen_random_uuid(),project_id uuid,kind text,created_at timestamptz default clock_timestamp());
  create table public.bank_transaction_matches(id uuid primary key,bank_transaction_id uuid,invoice_id uuid references public.invoices(id),amount_applied numeric,confidence text,matched_by uuid,matched_at timestamptz);
  alter table public.invoices alter id set default gen_random_uuid();
  alter table public.invoices alter updated_at set default clock_timestamp();
  grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
  insert into profiles(id,role) values('${owner}','owner'),('${crew}','field_worker');
  insert into projects(id,name) values('${job}','Test job');
  insert into estimates(id,project_id) values('${estimate}','${job}');
  insert into estimate_line_items(id,estimate_id,is_locked) values('${line}','${estimate}',false);
`);
await db.exec(read('../supabase/migrations/20260907013630_spend_review_locked_assignment.sql'));
await db.exec(read('../supabase/migrations/20260907222408_limit_spend_guard_to_new_confirmations.sql'));
await db.exec(read('../supabase/migrations/00132_split_vendor_invoice_cross_project.sql'));
await db.exec(read('../supabase/migrations/20260907225549_allow_reviewed_split_closed_lines.sql'));
await db.exec(read('../supabase/migrations/20261026220934_resplit_spend_group.sql'));
await db.exec(read('../supabase/migrations/20261105185637_non_job_transaction_resolution.sql'));
after(() => db.close());

async function asRole(role, actor, fn) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? '']);
  await db.exec(`set role ${role}`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
let sequence = 100;
async function seed(extra = {}) {
  const values = { id: uid(++sequence), vendor_name: 'Source transaction', amount: 1500, paid_amount: 1500,
    payment_status: 'paid', payment_method: 'bank_transfer', source: 'quickbooks', quickbooks_id: `qb_purchase_${sequence}`,
    quickbooks_purchase_id: String(sequence), quickbooks_bill_id: 'preserved-bill-link', gmail_message_id: 'source-message',
    attachment_storage_path: 'original.pdf', review_status: 'needs_review', review_reason: 'Choose a job', ...extra };
  const keys = Object.keys(values);
  await db.query(`insert into invoices(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
  return row(values.id);
}
async function row(id) { return (await db.query('select *,updated_at::text as exact_updated_at from invoices where id=$1', [id])).rows[0]; }
async function resolve(record, reason = 'owner_draw', note = null, version = record.exact_updated_at) {
  return asRole('authenticated', owner, () => db.query('select resolve_non_job_transaction($1,$2,$3,$4)', [record.id, reason, note, version]));
}
async function reopen(record, note = 'Receipt confirms a real job expense') {
  return asRole('authenticated', owner, () => db.query('select reopen_non_job_transaction($1,$2,$3)', [record.id, note, record.exact_updated_at]));
}

test('both explicit reasons preserve financial/source facts, detach costs, and append complete office audit', async () => {
  for (const reason of ['owner_draw', 'card_payment_transfer']) {
    const original = await seed({project_id:job, estimate_line_item_id:line});
    await resolve(original, reason, ' Reviewed source ');
    const changed = await row(original.id);
    for (const key of ['id','amount','paid_amount','payment_status','payment_method','source','quickbooks_id','quickbooks_purchase_id','quickbooks_bill_id','gmail_message_id','attachment_storage_path']) {
      assert.deepEqual(changed[key], original[key], key);
    }
    assert.equal(changed.project_id, null); assert.equal(changed.estimate_line_item_id, null);
    assert.equal(changed.review_status, 'ok'); assert.equal(changed.non_job_reason, reason);
    assert.equal(changed.non_job_resolved_by, owner); assert.equal(changed.non_job_note, 'Reviewed source');
    assert.notEqual(changed.exact_updated_at, original.exact_updated_at);
    const history = await asRole('authenticated', owner, () => db.query('select * from invoice_non_job_history where invoice_id=$1', [original.id]));
    assert.equal(history.rows.length, 1); const event = history.rows[0];
    assert.equal(event.actor_id, owner); assert.equal(event.action, 'resolved'); assert.equal(event.reason, reason);
    assert.equal(event.before_record.project_id, job); assert.equal(event.after_record.project_id, null);
    assert.equal(event.before_record.amount, 1500); assert.equal(event.after_record.quickbooks_id, original.quickbooks_id);
    assert.equal((await db.query('select count(*)::int n from invoices where id=$1 and non_job_reason is null', [original.id])).rows[0].n, 0);
  }
});

test('crew and anonymous cannot classify through RPC or direct table updates', async () => {
  const record = await seed();
  await assert.rejects(() => asRole('authenticated', crew, () => db.query('select resolve_non_job_transaction($1,$2,null,$3)', [record.id,'owner_draw',record.exact_updated_at])), /Office access/);
  await assert.rejects(() => asRole('authenticated', crew, () => db.query("update invoices set non_job_reason='owner_draw' where id=$1", [record.id])), /Office access/);
  await assert.rejects(() => asRole('anon', null, () => db.query('select resolve_non_job_transaction($1,$2,null,$3)', [record.id,'owner_draw',record.exact_updated_at])), /permission denied/);
  await assert.rejects(() => asRole('service_role', null, () => db.query("update invoices set non_job_reason='owner_draw' where id=$1", [record.id])), /Office access/);
  assert.equal((await row(record.id)).non_job_reason, null);
});

test('stale versions, unsupported reason, money edits in a transition, and preclassified insertion fail atomically', async () => {
  const record = await seed();
  await assert.rejects(() => resolve(record,'owner_draw',null,'2000-01-01T00:00:00Z'), /changed/);
  await assert.rejects(() => resolve(record,'other'), /Choose a non-job reason/);
  await assert.rejects(() => asRole('authenticated',owner,()=>db.query("update invoices set non_job_reason='owner_draw',amount=1 where id=$1",[record.id])), /financial details/);
  await assert.rejects(() => seed({non_job_reason:'owner_draw'}), /Save the transaction first/);
  assert.equal((await db.query('select count(*)::int n from invoice_non_job_history where invoice_id=$1',[record.id])).rows[0].n,0);
});

test('splits, direct and reverse duplicate links, locked lines, and final audits require their native review first', async () => {
  for (const extra of [{split_group_id:uid(20)}, {duplicate_of_id:uid(21)}]) {
    const record=await seed(extra); await assert.rejects(()=>resolve(record), /linked or split/);
  }
  const reverse=await seed(); await seed({duplicate_of_id:reverse.id});
  await assert.rejects(()=>resolve(reverse), /linked or split/);
  const locked=await seed({project_id:job,estimate_line_item_id:line});
  await db.query('update estimate_line_items set is_locked=true where id=$1',[line]);
  await assert.rejects(()=>resolve(locked), /closed budget line/);
  await db.query('update estimate_line_items set is_locked=false where id=$1',[line]);
  await db.query("insert into project_finance_records(project_id,kind) values($1,'final')",[job]);
  await assert.rejects(()=>resolve(locked), /final job audit/);
  await db.query("insert into project_finance_records(project_id,kind) values($1,'forecast')",[job]);
  await assert.rejects(()=>resolve(locked), /final job audit/);
  await db.query("insert into project_finance_records(project_id,kind) values($1,'reopen')",[job]);
  await resolve(locked);
});

test('old confirmation, direct payment, split and sync paths cannot mutate a resolved record', async () => {
  const record=await seed(); await resolve(record);
  for (const change of ["amount=1", "project_id='"+job+"'", "review_status='needs_review'", "pay_approval_status='approved'", "payment_status='unpaid'", "quickbooks_id=null", "non_job_note='erase evidence'"]) {
    await assert.rejects(()=>db.query(`update invoices set ${change} where id=$1`,[record.id]), /Reopen this non-job/);
  }
  await assert.rejects(()=>asRole('authenticated',owner,()=>db.query('select confirm_spend_review($1,$2)',[[record.id],JSON.stringify({project_id:job,estimate_line_item_id:line})])), /Reopen this non-job/);
  const countBefore=(await db.query('select count(*)::int n from invoices')).rows[0].n;
  await assert.rejects(()=>asRole('authenticated',owner,()=>db.query('select split_vendor_invoice($1,$2)',[record.id,JSON.stringify([{amount:750},{amount:750}])])), /foreign key constraint/);
  assert.equal((await db.query('select count(*)::int n from invoices')).rows[0].n,countBefore);
  assert.equal((await row(record.id)).non_job_reason,'owner_draw');
});

test('audit is immutable for office and service clients, hidden from crew, and retains the source row', async () => {
  const record=await seed(); await resolve(record);
  for(const role of ['authenticated','service_role']) {
    for(const sql of ['update invoice_non_job_history set note=\'rewrite\' where invoice_id=$1', 'delete from invoice_non_job_history where invoice_id=$1', 'insert into invoice_non_job_history select * from invoice_non_job_history where invoice_id=$1']) {
      await assert.rejects(()=>asRole(role,owner,()=>db.query(sql,[record.id])), /permission denied/);
    }
  }
  await assert.rejects(()=>db.query('update invoice_non_job_history set note=\'rewrite\' where invoice_id=$1',[record.id]), /immutable/);
  await assert.rejects(()=>db.query('delete from invoice_non_job_history where invoice_id=$1',[record.id]), /immutable/);
  await assert.rejects(()=>db.query('delete from invoices where id=$1',[record.id]), /foreign key constraint/);
  assert.equal((await asRole('authenticated',crew,()=>db.query('select * from invoice_non_job_history'))).rows.length,0);
});

test('reopen needs a reason, preserves money, re-enters review without allocation, and ordinary confirmation guard remains', async () => {
  const record=await seed(); await resolve(record,'card_payment_transfer');
  const resolved=await row(record.id);
  await assert.rejects(()=>reopen(resolved,' '), /Explain why/);
  await reopen(resolved);
  const reopened=await row(record.id);
  assert.equal(reopened.non_job_reason,null); assert.equal(reopened.review_status,'needs_review');
  assert.equal(reopened.project_id,null); assert.equal(reopened.estimate_line_item_id,null);
  assert.equal(reopened.amount,record.amount); assert.equal(reopened.quickbooks_id,record.quickbooks_id);
  const history=(await db.query('select * from invoice_non_job_history where invoice_id=$1 order by created_at',[record.id])).rows;
  assert.equal(history.length,2); assert.equal(history[1].action,'reopened'); assert.equal(history[1].reason,'card_payment_transfer');
  assert.equal(history[1].before_record.non_job_reason,'card_payment_transfer'); assert.equal(history[1].after_record.non_job_reason,null);
  await assert.rejects(()=>db.query("update invoices set review_status='ok' where id=$1",[record.id]), /Choose a job and budget line/);
  await asRole('authenticated',owner,()=>db.query('select confirm_spend_review($1,$2)',[[record.id],JSON.stringify({project_id:job,estimate_line_item_id:line})]));
  assert.equal((await row(record.id)).review_status,'ok');
});

test('public mutation RPCs stay invoker-only and service role cannot execute them or audit functions', async () => {
  const definitions=(await db.query("select proname,prosecdef from pg_proc where proname in ('resolve_non_job_transaction','reopen_non_job_transaction','guard_invoice_non_job')")).rows;
  assert.equal(definitions.length,3); assert.ok(definitions.every(p=>!p.prosecdef));
  for (const role of ['anon','service_role']) {
    assert.equal((await db.query("select has_function_privilege($1,'public.resolve_non_job_transaction(uuid,text,text,timestamptz)','execute') allowed",[role])).rows[0].allowed,false);
  }
  assert.equal((await db.query("select has_function_privilege('authenticated','finance_internal.audit_invoice_non_job()','execute') allowed")).rows[0].allowed,false);
});

test('reopened ordinary expense can use the current split and resplit workflows while source audit stays accessible', async () => {
  const record=await seed({source:'field_capture',quickbooks_id:null,quickbooks_purchase_id:null,quickbooks_bill_id:null,created_at:'2026-11-01T00:00:00Z'});
  await resolve(record); await reopen(await row(record.id));
  const split=parts=>JSON.stringify(parts.map(amount=>({amount,project_id:job,line_item_id:line})));
  const pieces=(await asRole('authenticated',owner,()=>db.query('select * from split_spend_invoice($1,$2)',[record.id,split([1000,500])]))).rows;
  assert.equal(pieces.length,2); assert.equal(pieces.reduce((n,r)=>n+Number(r.amount),0),1500);
  assert.ok(pieces.every(r=>r.non_job_reason===null));
  assert.equal(pieces.find(r=>r.id!==record.id).non_job_note,null);
  assert.match(pieces.find(r=>r.id===record.id).non_job_note,/Receipt confirms/);
  const group=pieces[0].split_group_id;
  const resplit=(await asRole('authenticated',owner,()=>db.query('select * from resplit_spend_group($1,$2)',[group,split([600,600,300])]))).rows;
  assert.equal(resplit.length,3);assert.ok(resplit.some(r=>r.id===record.id));
  assert.equal((await db.query('select count(*)::int n from invoice_non_job_history where invoice_id=$1',[record.id])).rows[0].n,2);
});

test('outbound claim and classification exclude each other in either order, including an abandoned old claim', async () => {
  const record=await seed({source:'field_capture'});
  const claim=()=>asRole('service_role',null,()=>db.query('select claim_invoice_quickbooks_push($1) token',[[record.id]]));
  const token=(await claim()).rows[0].token;
  await assert.rejects(()=>resolve(record), /QuickBooks send is active or awaiting reconciliation/);
  await assert.rejects(()=>claim(), /QuickBooks send is active or awaiting reconciliation/);
  // A crashed process leaves the claim. Age alone never establishes whether
  // the remote payment/expense was posted, so it cannot authorize a retry.
  await db.query("update finance_internal.invoice_quickbooks_push_claims set claimed_at='2000-01-01' where invoice_id=$1",[record.id]);
  await assert.rejects(()=>claim(), /awaiting reconciliation/);
  await asRole('service_role',null,()=>db.query('select release_invoice_quickbooks_push($1)',[uid(999)]));
  await assert.rejects(()=>resolve(record), /awaiting reconciliation/);
  await asRole('service_role',null,()=>db.query('select release_invoice_quickbooks_push($1)',[token]));
  await resolve(record);
  await assert.rejects(()=>claim(), /resolved as non-job/);
  assert.equal((await db.query('select count(*)::int n from finance_internal.invoice_quickbooks_push_claims where invoice_id=$1',[record.id])).rows[0].n,0);
});

test('claims are atomic per batch, restricted to service RPCs, and released only by matching token', async () => {
  const first=await seed(), second=await seed();
  for(const role of ['anon','authenticated']) {
    await assert.rejects(()=>asRole(role,owner,()=>db.query('select claim_invoice_quickbooks_push($1)',[[first.id]])), /permission denied/);
    await assert.rejects(()=>asRole(role,owner,()=>db.query('select release_invoice_quickbooks_push($1)',[uid(999)])), /permission denied/);
  }
  const token=(await asRole('service_role',null,()=>db.query('select claim_invoice_quickbooks_push($1) token',[[first.id,second.id,first.id]]))).rows[0].token;
  assert.equal((await db.query('select count(*)::int n from finance_internal.invoice_quickbooks_push_claims where claim_token=$1',[token])).rows[0].n,2);
  const third=await seed();
  await assert.rejects(()=>asRole('service_role',null,()=>db.query('select claim_invoice_quickbooks_push($1)',[[third.id,first.id]])), /awaiting reconciliation/);
  assert.equal((await db.query('select count(*)::int n from finance_internal.invoice_quickbooks_push_claims where invoice_id=$1',[third.id])).rows[0].n,0);
  await assert.rejects(()=>asRole('service_role',null,()=>db.query('delete from finance_internal.invoice_quickbooks_push_claims')), /permission denied/);
  await asRole('service_role',null,()=>db.query('select release_invoice_quickbooks_push($1)',[token]));
  await resolve(first);await resolve(second);
});
