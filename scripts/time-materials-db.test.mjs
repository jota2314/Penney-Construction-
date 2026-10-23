// PGLITE_MODULE may point to a separately installed @electric-sql/pglite/dist/index.js.
// Every write here is to isolated, in-memory PostgreSQL; no production connection.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE
  ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
await db.exec(read('./time-materials-test-schema.sql'));
await db.exec(read('../supabase/migrations/20261023160727_change_order_time_materials.sql'));
after(() => db.close());
const ids = Object.fromEntries(['owner','precon_manager','office_admin','project_manager','field']
  .map((role,i) => [role, `00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
for (const [role,id] of Object.entries(ids)) await db.query(
  'insert into auth.users values($1);', [id]);
for (const [role,id] of Object.entries(ids)) await db.query('insert into profiles values($1,$2)',[id,role]);
const one = async (sql,params=[]) => (await db.query(sql,params)).rows[0];
async function actor(role,fn,pgRole='authenticated') {
  await db.query("select set_config('test.uid',$1,false)",[role ? ids[role] : '']);
  await db.exec(`set role ${pgRole}`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
async function fixture(status='submitted') {
  await db.query("select set_config('test.uid',$1,false)",[ids.owner]);
  const project = (await one('insert into projects(assigned_pm) values($1) returning id',[ids.project_manager])).id;
  const co = (await one(`insert into change_orders(project_id,billing_type,tm_terms,status)
    values($1,'time_materials','Labor at the documented client rate; materials at agreed rates.',$2) returning id`,[project,status])).id;
  const line = (await one('insert into estimate_line_items(change_order_id) values($1) returning id',[co])).id;
  const phase = (await one('insert into schedule_phases(project_id,estimate_line_item_id) values($1,$2) returning id',[project,line])).id;
  const log = (await one(`insert into daily_logs(project_id,schedule_phase_id,estimate_line_item_id,author_id,started_at,ended_at)
    values($1,$2,$3,$4,'2026-10-23 12:00:00+00','2026-10-23 16:00:00+00') returning id`,[project,phase,line,ids.field])).id;
  const invoice = (await one('insert into invoices(project_id,change_order_id,estimate_line_item_id) values($1,$2,$3) returning id',[project,co,line])).id;
  return {project,co,line,phase,log,invoice};
}
const get = id => one('select *,updated_at::text stamp from change_order_tm_entries where id=$1',[id]);
const add = (f, overrides={}) => {
  const v = {project:f.project,co:f.co,category:'labor',qty:3.3333,rate:19.995,log:null,invoice:null,...overrides};
  return one(`insert into change_order_tm_entries(project_id,change_order_id,work_date,category,description,quantity,unit,unit_rate,source_daily_log_id,source_invoice_id)
    values($1,$2,'2026-10-23',$3,'Slab work',$4,'hr',$5,$6,$7) returning *,updated_at::text stamp`,
    [v.project,v.co,v.category,v.qty,v.rate,v.log,v.invoice]);
};
const publish = id => one("update change_order_tm_entries set status='published' where id=$1 returning *",[id]);
const voidEntry = (id,reason='Incorrect charge; replaced after review') => one("update change_order_tm_entries set status='void',void_reason=$2 where id=$1 returning *",[id,reason]);

test('office roles and assigned PM can manage; unrelated PM, field, anonymous cannot', async () => {
  const f=await fixture();
  for (const role of ['owner','precon_manager','office_admin','project_manager']) {
    const e=await actor(role,()=>add(f)); assert.equal(e.created_by,ids[role]);
  }
  await actor('field',async()=>{
    assert.equal((await db.query('select id from change_order_tm_entries where project_id=$1',[f.project])).rows.length,0);
    await assert.rejects(()=>add(f),/Not allowed|row-level security/i);
  });
  await db.query('update projects set assigned_pm=null where id=$1',[f.project]);
  await actor('project_manager',async()=>{
    assert.equal((await db.query('select id from change_order_tm_entries where project_id=$1',[f.project])).rows.length,0);
    await assert.rejects(()=>add(f),/Not allowed|row-level security/i);
  });
  await actor(null,async()=>{ await assert.rejects(()=>add(f),/Not allowed|row-level security/i); });
  await actor(null,async()=>{ await assert.rejects(()=>db.query('select * from change_order_tm_entries'),/permission denied/i); },'anon');
});

test('database rounds charge amount, preserves explicit zero, and prevents unpriced publish', async () => {
  const f=await fixture();
  await actor('owner',async()=>{
    const e=await add(f); assert.equal(Number(e.amount),66.65);
    const pending=await add(f,{rate:null}); assert.equal(pending.amount,null);
    await assert.rejects(()=>publish(pending.id),/client rate/i);
    const zero=await add(f,{rate:0}); const pub=await publish(zero.id);
    assert.equal(Number(pub.amount),0); assert.ok(pub.published_at); assert.equal(pub.published_by,ids.owner);
    await assert.rejects(()=>add(f,{qty:0}),/check constraint/i);
    await assert.rejects(()=>add(f,{rate:-1}),/check constraint/i);
    await assert.rejects(()=>add(f,{qty:'NaN'}),/check constraint/i);
  });
});

test('cross-project/co, unfinished and unreviewed sources are rejected, with no financial writes', async () => {
  const f=await fixture(), foreign=await fixture();
  const before=await one('select to_jsonb(i) record from invoices i where id=$1',[f.invoice]);
  const logBefore=await one('select to_jsonb(d) record from daily_logs d where id=$1',[f.log]);
  await actor('owner',async()=>{
    await assert.rejects(()=>add(f,{co:foreign.co}),/does not belong/i);
    await assert.rejects(()=>add(f,{log:foreign.log}),/completed, reviewed labor/i);
    await assert.rejects(()=>add(f,{category:'material',invoice:foreign.invoice}),/reviewed bill/i);
    await assert.rejects(()=>add(f,{category:'material',log:f.log}),/labor category/i);
    const e=await add(f,{log:f.log}); await publish(e.id);
    const material=await add(f,{category:'material',invoice:f.invoice}); await publish(material.id);
  });
  assert.deepEqual(await one('select to_jsonb(i) record from invoices i where id=$1',[f.invoice]),before);
  assert.deepEqual(await one('select to_jsonb(d) record from daily_logs d where id=$1',[f.log]),logBefore);
  const unfinished=await fixture(); await db.query('update daily_logs set ended_at=null where id=$1',[unfinished.log]);
  await actor('owner',()=>assert.rejects(()=>add(unfinished,{log:unfinished.log}),/completed, reviewed labor/i));
  const review=await fixture(); await db.query("update invoices set review_status='needs_review' where id=$1",[review.invoice]);
  await actor('owner',()=>assert.rejects(()=>add(review,{category:'material',invoice:review.invoice}),/reviewed bill/i));
  const unassigned=await fixture(); await db.query('update invoices set project_id=null where id=$1',[unassigned.invoice]);
  await actor('owner',()=>assert.rejects(()=>add(unassigned,{category:'material',invoice:unassigned.invoice}),/reviewed bill/i));
});

test('one active charge per source prevents double counting; void preserves history and permits replacement',async()=>{
  const f=await fixture();
  await actor('owner',async()=>{
    const e=await add(f,{log:f.log}); const original=await publish(e.id);
    await assert.rejects(()=>add(f,{log:f.log}),/duplicate key/i);
    await assert.rejects(()=>db.query('update change_order_tm_entries set quantity=9 where id=$1',[e.id]),/immutable/i);
    await assert.rejects(()=>voidEntry(e.id,''),/void with a reason/i);
    await assert.rejects(()=>db.query("update change_order_tm_entries set status='void',void_reason='Wrong rate',unit_rate=99 where id=$1",[e.id]),/preserves/i);
    const voided=await voidEntry(e.id); assert.deepEqual(voided.published_at,original.published_at);
    assert.equal(voided.published_by,original.published_by); assert.equal(voided.amount,original.amount);
    await assert.rejects(()=>db.query("update change_order_tm_entries set status='draft' where id=$1",[e.id]),/immutable/i);
    const replacement=await add(f,{log:f.log,rate:22}); assert.notEqual(replacement.id,e.id);
    assert.equal((await db.query('select id from change_order_tm_entries where source_daily_log_id=$1',[f.log])).rows.length,2);
  });
});

test('publication rejects changed evidence until the draft is reviewed and saved again',async()=>{
  const f=await fixture(); const e=await actor('owner',()=>add(f,{category:'material',invoice:f.invoice}));
  await db.query('update invoices set amount=150,updated_at=clock_timestamp() where id=$1',[f.invoice]);
  await actor('owner',async()=>{
    await assert.rejects(()=>publish(e.id),/Source evidence changed/i);
    await db.query('update change_order_tm_entries set unit_rate=27 where id=$1',[e.id]);
    const fresh=await publish(e.id); assert.equal(Number(fresh.unit_rate),27);
  });
});

test('compare-and-swap rejects stale edits and identity reassignment',async()=>{
  const f=await fixture(), other=await fixture();
  await actor('owner',async()=>{
    const e=await add(f); await db.query('update change_order_tm_entries set unit_rate=25 where id=$1',[e.id]);
    const stale=await db.query("update change_order_tm_entries set status='published' where id=$1 and updated_at=$2 returning id",[e.id,e.stamp]);
    assert.equal(stale.rows.length,0); assert.equal((await get(e.id)).status,'draft');
    await assert.rejects(()=>db.query('update change_order_tm_entries set change_order_id=$2,project_id=$3 where id=$1',[e.id,other.co,other.project]),/identity/i);
  });
});

test('T&M terms and zero fixed impact are enforced; issued terms/history cannot be rewritten',async()=>{
  const f=await fixture('draft');
  await actor('owner',async()=>{
    await db.query('update change_orders set tm_terms=null where id=$1',[f.co]);
    await assert.rejects(()=>db.query("update change_orders set status='submitted' where id=$1",[f.co]),/billing terms/i);
    const e=await add(f); await assert.rejects(()=>publish(e.id),/Submit or approve/i);
    await assert.rejects(()=>db.query('update change_orders set price_impact=100 where id=$1',[f.co]),/fixed contract price/i);
    await assert.rejects(()=>db.query("update change_orders set billing_type='fixed_price' where id=$1",[f.co]),/ledger history/i);
    await db.query("update change_orders set tm_terms='Actual documented quantities at agreed rates',status='submitted' where id=$1",[f.co]);
    await publish(e.id);
    await assert.rejects(()=>db.query("update change_orders set tm_terms='New rate' where id=$1",[f.co]),/cannot change/i);
    await assert.rejects(()=>db.query("update change_orders set title='Different work' where id=$1",[f.co]),/scope and billing terms cannot change/i);
    await assert.rejects(()=>db.query("update change_orders set description='Additional work' where id=$1",[f.co]),/scope and billing terms cannot change/i);
    await assert.rejects(()=>db.query("update change_orders set status='draft' where id=$1",[f.co]),/cannot be reset/i);
  });
  await assert.rejects(()=>db.query('delete from change_orders where id=$1',[f.co]),/foreign key constraint/i);
});

test('T&M creation is role-gated and substantive terms update the signature version',async()=>{
  const f=await fixture('draft');
  await actor('field',()=>assert.rejects(()=>db.query("insert into change_orders(project_id,billing_type) values($1,'time_materials')",[f.project]),/Only the office/i));
  await actor('owner',async()=>{
    const before=await one('select updated_at::text stamp from change_orders where id=$1',[f.co]);
    await db.query("update change_orders set description='Complete slab replacement' where id=$1",[f.co]);
    const after=await one('select updated_at::text stamp from change_orders where id=$1',[f.co]);
    assert.notEqual(after.stamp,before.stamp);
  });
});

test('approval and issuance stay locked after void/rejection, including deliberate history-clearing attempts',async()=>{
  for (const firstStatus of ['approved','submitted']) for (const closedStatus of ['void','rejected']) {
    const f=await fixture(firstStatus);
    await actor('owner',async()=>{
      const before=await one('select tm_issued_at,approved_at from change_orders where id=$1',[f.co]);
      assert.ok(before.tm_issued_at);
      if(firstStatus==='approved') assert.ok(before.approved_at);
      await db.query('update change_orders set status=$2 where id=$1',[f.co,closedStatus]);
      assert.deepEqual(await one('select tm_issued_at,approved_at from change_orders where id=$1',[f.co]),before);
      await assert.rejects(()=>db.query("update change_orders set title='Rewritten scope' where id=$1",[f.co]),/cannot change/i);
      await assert.rejects(()=>db.query("update change_orders set tm_terms='New terms' where id=$1",[f.co]),/cannot change/i);
      await assert.rejects(()=>db.query("update change_orders set status='draft' where id=$1",[f.co]),/cannot be reset/i);
      await assert.rejects(()=>db.query('update change_orders set tm_issued_at=null where id=$1',[f.co]),/history cannot be changed or cleared/i);
      if(firstStatus==='approved') await assert.rejects(()=>db.query('update change_orders set approved_at=null where id=$1',[f.co]),/approval history cannot be cleared/i);
    });
  }
});

test('portal service can read snapshots but cannot mutate ledger; trigger functions have no public execution',async()=>{
  const f=await fixture(); const e=await actor('owner',()=>add(f));
  await actor(null,async()=>{
    assert.equal((await one('select count(*)::int n from change_order_tm_entries where id=$1',[e.id])).n,1);
    await assert.rejects(()=>db.query("update change_order_tm_entries set status='published' where id=$1",[e.id]),/permission denied/i);
  },'service_role');
  for(const fn of ['guard_time_material_entry()','guard_change_order_tm_terms()']){
    assert.equal((await one("select has_function_privilege('anon',$1,'execute') allowed",[fn])).allowed,false);
    assert.equal((await one("select has_function_privilege('service_role',$1,'execute') allowed",[fn])).allowed,false);
  }
  await actor('owner',()=>assert.rejects(()=>db.exec('truncate change_order_tm_entries'),/permission denied/i));
  await actor('owner',()=>assert.rejects(()=>db.query('delete from change_order_tm_entries where id=$1',[e.id]),/permission denied/i));
});
