import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../penney-mcp/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000001';
const field = '00000000-0000-4000-8000-000000000002';
const project = '00000000-0000-4000-8000-000000000003';
const otherProject = '00000000-0000-4000-8000-000000000004';
const sub = '00000000-0000-4000-8000-000000000005';
await db.exec(fs.readFileSync(new URL('./schedule-sync-test-schema.sql', import.meta.url), 'utf8'));
await db.exec(`
insert into public.profiles values('${owner}','owner'),('${field}','field');
insert into public.projects(id,name,status,contract_value) values('${project}','Fixture job','in_progress',12345),('${otherProject}','Other job','in_progress',45678);
select set_config('request.jwt.claim.sub','${owner}',false);
select set_config('request.jwt.claim.role','authenticated',false);
`);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261017003312_inspection_schedule_lifecycle.sql', import.meta.url), 'utf8'));
after(async () => db.close());

const one = async (sql, params=[]) => {
  const row=(await db.query(sql,params)).rows[0];
  return row && Object.fromEntries(Object.entries(row).map(([key,value]) => [key,value instanceof Date
    ? (['start_date','end_date','planned_start_date','planned_end_date','scheduled_for'].includes(key) ? value.toISOString().slice(0,10) : value.toISOString()) : value]));
};
const inspection = id => one('select *,updated_at::text as updated_at from public.project_inspections where id=$1',[id]);
const phase = id => one('select * from public.schedule_phases where id=$1',[id]);
const iso = value => value == null ? null : new Date(value).toISOString();
async function createPhase(name='Inspection — Rough Plumbing', options={}) {
  return one(`insert into public.schedule_phases(project_id,name,start_date,end_date,planned_start_date,planned_end_date,event_type,phase_scope,created_by)
    values($1,$2,'2026-10-10','2026-10-10','2026-10-10','2026-10-10',$3,$4,$5) returning *`,
    [options.project ?? project,name,options.type ?? 'inspection',options.scope ?? 'master',owner]);
}
async function historicalPhase(name='Historical final', options={}) {
  await db.exec("select set_config('penney.inspection_create_existing','true',false)");
  try { return await createPhase(name,options); }
  finally { await db.exec("select set_config('penney.inspection_create_existing','',false)"); }
}
async function createInspection(name='Historical final', extra={}) {
  return one(`insert into public.project_inspections(project_id,name,status,completed_at,is_final,created_by)
    values($1,$2,$3,$4,$5,$6) returning *,updated_at::text as updated_at`,[extra.project ?? project,name,extra.status ?? 'pending',extra.completedAt ?? null,extra.final ?? false,owner]);
}
async function update(id,patch,expected) {
  const row = await inspection(id);
  return one('select * from public.update_project_inspection_lifecycle($1,$2,$3)',[id,JSON.stringify(patch),expected ?? row.updated_at]);
}
async function link(id,phaseId,authority='inspection') {
  const row=await inspection(id);
  return one('select * from public.link_project_inspection_schedule($1,$2,$3,$4)',[id,phaseId,authority,row.updated_at]);
}

test('new master inspection creates an exact linked checklist, never name-matches history',async()=>{
  const old=await createInspection('Inspection — Rough Plumbing');
  const p=await createPhase();
  const linked=await one('select * from public.project_inspections where schedule_phase_id=$1',[p.id]);
  assert.ok(linked); assert.notEqual(linked.id,old.id);
  assert.equal((await inspection(old.id)).schedule_phase_id,null);
  assert.equal(linked.scheduled_for,null); assert.equal(linked.is_final,false);
});

test('passed/failure/reopening synchronize atomically without rewriting plans or project money',async()=>{
  const p=await createPhase('Final Plumbing');
  const i=await one('select * from public.project_inspections where schedule_phase_id=$1',[p.id]);
  const jobBefore=await one('select * from public.projects where id=$1',[project]);
  await update(i.id,{status:'passed',completed_at:'2026-10-14T15:30:00Z',is_final:true});
  let updated=await phase(p.id);
  assert.equal(updated.status,'completed'); assert.equal(iso(updated.actual_completed_at),'2026-10-14T15:30:00.000Z');
  assert.equal(updated.start_date,p.start_date); assert.equal(updated.planned_start_date,p.planned_start_date);
  const beforeRetry=await inspection(i.id);
  const countBefore=await one('select count(*)::int n from public.inspection_schedule_history where inspection_id=$1',[i.id]);
  await update(i.id,{status:'passed'});
  assert.equal(iso((await inspection(i.id)).completed_at),iso(beforeRetry.completed_at));
  assert.equal((await one('select count(*)::int n from public.inspection_schedule_history where inspection_id=$1',[i.id])).n,countBefore.n);
  await assert.rejects(()=>update(i.id,{status:'failed'},beforeRetry.updated_at),/changed/);
  assert.equal((await phase(p.id)).status,'completed');
  await update(i.id,{status:'failed',completed_at:'2026-10-15T14:00:00Z'});
  assert.equal((await phase(p.id)).status,'on_hold'); assert.equal((await phase(p.id)).actual_completed_at,null);
  await update(i.id,{status:'pending'});
  assert.equal((await phase(p.id)).status,'not_started'); assert.equal((await inspection(i.id)).completed_at,null);
  assert.deepEqual(await one('select * from public.projects where id=$1',[project]),jobBefore);
});

test('schedule completion/reopening syncs results; generic hold never invents failure',async()=>{
  const p=await createPhase();
  const i=await one('select * from public.project_inspections where schedule_phase_id=$1',[p.id]);
  await db.query("update public.schedule_phases set status='on_hold' where id=$1",[p.id]);
  assert.equal((await inspection(i.id)).status,'pending');
  await db.query("update public.schedule_phases set status='completed' where id=$1",[p.id]);
  assert.equal((await inspection(i.id)).status,'passed');
  assert.equal(iso((await inspection(i.id)).completed_at),iso((await phase(p.id)).actual_completed_at));
  await db.query("update public.schedule_phases set status='in_progress' where id=$1",[p.id]);
  assert.equal((await inspection(i.id)).status,'pending'); assert.equal((await phase(p.id)).actual_completed_at,null);
});

test('bookings synchronize both ways while original baseline stays intact',async()=>{
  const p=await createPhase(); const i=await one('select * from public.project_inspections where schedule_phase_id=$1',[p.id]);
  await update(i.id,{scheduled_for:'2026-10-19'});
  assert.equal((await phase(p.id)).start_date,'2026-10-19'); assert.equal((await phase(p.id)).end_date,'2026-10-19');
  assert.equal((await phase(p.id)).planned_start_date,'2026-10-10');
  await db.query("update public.schedule_phases set start_date='2026-10-20',end_date='2026-10-20' where id=$1",[p.id]);
  assert.equal((await inspection(i.id)).scheduled_for,'2026-10-20');
  await update(i.id,{scheduled_for:null});
  const cleared=await phase(p.id); assert.equal(cleared.is_confirmed,false); assert.equal(cleared.is_manually_scheduled,false); assert.equal(cleared.planned_start_date,'2026-10-10');
});

test('explicit historical links preserve unknown actual dates and choose one exact milestone',async()=>{
  const p1=await historicalPhase('Final'); const p2=await historicalPhase('Final');
  const i=await createInspection('Final',{status:'passed'});
  await link(i.id,p2.id);
  assert.equal((await phase(p1.id)).status,'not_started'); assert.equal((await phase(p2.id)).status,'completed');
  assert.equal((await phase(p2.id)).actual_completed_at,null); assert.equal((await inspection(i.id)).completed_at,null);
  assert.equal((await phase(p2.id)).start_date,'2026-10-10');
  await link(i.id,null); assert.equal((await inspection(i.id)).schedule_phase_id,null);
});

test('office can create a missing milestone without duplicate checklist rows',async()=>{
  const i=await createInspection('Previously passed',{status:'passed',completedAt:'2026-10-12T14:00:00Z'});
  const count=await one('select count(*)::int n from public.project_inspections');
  const made=await one('select * from public.create_project_inspection_phase($1,$2,$3)',[i.id,'2026-10-11',i.updated_at]);
  assert.ok(made.schedule_phase_id); assert.equal((await phase(made.schedule_phase_id)).status,'completed');
  assert.equal(iso((await phase(made.schedule_phase_id)).actual_completed_at),'2026-10-12T14:00:00.000Z');
  assert.equal((await one('select count(*)::int n from public.project_inspections')).n,count.n);
});

test('cross-project, daily and duplicate links are rejected with no partial edits',async()=>{
  const i=await createInspection(); const other=await historicalPhase('Other',{project:otherProject});
  await assert.rejects(()=>link(i.id,other.id),/this project/);
  const daily=await createPhase('Daily',{scope:'daily'}); await assert.rejects(()=>link(i.id,daily.id),/inspection milestone/);
  const already=await createPhase(); await assert.rejects(()=>link(i.id,already.id),/already linked/);
  assert.equal((await inspection(i.id)).schedule_phase_id,null);
  const p=await historicalPhase(); await link(i.id,p.id);
  await assert.rejects(()=>db.query("update public.schedule_phases set phase_scope='daily' where id=$1",[p.id]),/Unlink/);
});

test('database guards deny field and anonymous writes; history cannot be edited',async()=>{
  const p=await createPhase();
  const i=await one('select * from public.project_inspections where schedule_phase_id=$1',[p.id]);
  assert.equal((await one("select has_function_privilege('anon','public.update_project_inspection_lifecycle(uuid,jsonb,timestamptz,text,uuid)','execute') allowed")).allowed,false);
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${field}',false)`);
  try {
    await assert.rejects(()=>db.query("insert into public.project_inspections(project_id,name) values($1,'Unauthorized')",[project]),/row-level security|Office schedule access/);
    await assert.rejects(()=>db.query("update public.schedule_phases set status='completed' where id=$1",[p.id]),/Office schedule access/);
    await assert.rejects(()=>db.query('select public.update_project_inspection_lifecycle($1,$2,$3)',[i.id,'{"status":"passed"}',i.updated_at]),/Office schedule access/);
  } finally { await db.exec(`reset role;select set_config('request.jwt.claim.sub','${owner}',false)`); }
  await db.exec('set role authenticated');
  try {
    await assert.rejects(()=>db.exec("update public.inspection_schedule_history set source='rewritten'"),/permission denied/);
    await assert.rejects(()=>db.query("insert into public.inspection_schedule_history(project_id,inspection_id,actor_id,source) values($1,$2,$3,'fabricated')",[project,i.id,owner]),/row-level security/);
  }
  finally { await db.exec('reset role'); }
});

test('validated service portal writes record sub actor and remain atomic',async()=>{
  const p=await createPhase(); const i=await one('select * from public.project_inspections where schedule_phase_id=$1',[p.id]);
  await db.exec("set role service_role;select set_config('request.jwt.claim.sub','',false)");
  try {
    await db.query('select public.update_project_inspection_lifecycle($1,$2,$3,$4,$5)',[i.id,'{"status":"passed"}',(await inspection(i.id)).updated_at,'sub-portal',sub]);
  } finally { await db.exec(`reset role;select set_config('request.jwt.claim.sub','${owner}',false)`); }
  assert.equal((await phase(p.id)).status,'completed');
  const h=await one("select * from public.inspection_schedule_history where inspection_id=$1 and source='sub-portal'",[i.id]);
  assert.equal(h.actor_subcontractor_id,sub); assert.equal(h.actor_id,null);
  const before=await inspection(i.id);
  await assert.rejects(()=>update(i.id,{status:'invalid'}),/check constraint/);
  assert.equal((await phase(p.id)).status,'completed'); assert.equal(iso((await inspection(i.id)).updated_at),iso(before.updated_at));
});

test('authorized office writes work through RLS with existing timestamp trigger',async()=>{
  // The deployed checklist already has this trigger. Test the additive
  // migration alongside it, including a real authenticated (non-owner) role.
  await db.exec(`create function public.set_project_inspections_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
    create trigger trg_project_inspections_updated_at before update on public.project_inspections for each row execute function public.set_project_inspections_updated_at();
    set role authenticated;`);
  try {
    const p=await createPhase('Office authorized inspection');
    const linked=await one('select id from public.project_inspections where schedule_phase_id=$1',[p.id]);
    const i=await inspection(linked.id);
    await update(i.id,{status:'passed',completed_at:'2026-10-16T15:00:00Z'});
    assert.equal((await phase(p.id)).status,'completed');
    const history=await one('select actor_id,source from public.inspection_schedule_history where inspection_id=$1 order by created_at desc limit 1',[i.id]);
    assert.equal(history.actor_id,owner); assert.equal(history.source,'office');
  } finally { await db.exec('reset role'); }
});
