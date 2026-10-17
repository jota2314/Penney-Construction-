import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../penney-mcp/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
await db.exec(read('schedule-sync-test-schema.sql'));
await db.exec(`alter table public.schedule_phases add column client_completed_at timestamptz;
create function public.fixture_touch() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;
create trigger touch_phase before update on public.schedule_phases for each row execute function public.fixture_touch();
create trigger touch_log before update on public.daily_logs for each row execute function public.fixture_touch();`);
await db.exec(read('../supabase/migrations/20261017005039_inspection_schedule_lifecycle.sql'));
await db.exec(read('../supabase/migrations/20261017005130_schedule_field_progress_review.sql'));
await db.exec(read('../supabase/migrations/20261017011240_inspection_link_concurrency.sql'));
await db.exec(`create trigger fixture_estimate_sync after update of status on public.projects for each row execute function public.sync_estimate_status_on_project_change();`);
after(() => db.close());
const owner='00000000-0000-4000-8000-000000000001', field='00000000-0000-4000-8000-000000000002';
const one=async (sql,params=[]) => (await db.query(sql,params)).rows[0];
await db.exec(`insert into profiles values('${owner}','owner'),('${field}','field');select set_config('request.jwt.claim.sub','${owner}',false);select set_config('request.jwt.claim.role','authenticated',false);`);
async function fixture() {
  const job=(await one("insert into projects(id,name,status,contract_value) values(gen_random_uuid(),'Fixture','contracted',50000) returning id")).id;
  const phase=(await one("insert into schedule_phases(project_id,name,start_date,end_date,planned_start_date,planned_end_date,created_by) values($1,'Rough carpentry','2026-10-10','2026-10-12','2026-10-10','2026-10-12',$2) returning id",[job,owner])).id;
  const daily=(await one("insert into schedule_phases(project_id,name,start_date,end_date,phase_scope,event_type,created_by) values($1,'Crew work','2026-10-12','2026-10-12','daily','crew',$2) returning id",[job,owner])).id;
  const log=(await one("insert into daily_logs(project_id,schedule_phase_id,author_id,text) values($1,$2,$3,'Framing underway; one day remains.') returning id",[job,daily,field])).id;
  await db.query('insert into estimates(project_id) values($1)',[job]);
  return {job,phase,daily,log};
}
const getPhase=id=>one('select *,updated_at::text stamp from schedule_phases where id=$1',[id]);
const getLog=id=>one('select *,updated_at::text stamp from daily_logs where id=$1',[id]);
async function review(f,{status='in_progress',end=null,note='Verified framing on site',phase=f.phase}={}) {
  const l=await getLog(f.log), p=phase ? await getPhase(phase):null;
  return one('select public.review_schedule_field_progress($1,$2,$3,$4,$5,$6,$7) id',[f.log,phase,l.stamp,p?.stamp ?? null,status,end,note]);
}

test('field verification updates chosen master, retains baseline, links future dispatch reports and audits evidence',async()=>{
  const f=await fixture(); const original=await getPhase(f.phase), evidence=await getLog(f.log);
  await review(f,{end:'2026-10-15'});
  const p=await getPhase(f.phase); assert.equal(p.status,'in_progress');assert.equal(new Date(p.end_date).toISOString().slice(0,10),'2026-10-15');assert.equal(p.is_manually_scheduled,true);assert.equal(new Date(p.planned_end_date).toISOString(),new Date(original.planned_end_date).toISOString());assert.equal(p.is_confirmed,false);
  assert.equal((await getPhase(f.daily)).master_phase_id,f.phase);
  assert.equal((await getLog(f.log)).stamp,evidence.stamp);
  const r=await one('select * from schedule_progress_reviews where daily_log_id=$1',[f.log]);assert.equal(r.before_phase.status,'not_started');assert.equal(r.after_phase.status,'in_progress');assert.equal(r.reviewed_by,owner);
  const later=await one('insert into daily_logs(schedule_phase_id,author_id,text) values($1,$2,$3) returning *',[f.daily,field,'New report, same assigned phase']);assert.equal(later.master_phase_id,f.phase);assert.equal(later.project_id,f.job);
  await assert.rejects(()=>review(f),/already reviewed/);
});

test('cross-project targets and stale evidence/phase tokens cannot apply',async()=>{
  const f=await fixture(), other=await fixture(), l=await getLog(f.log),p=await getPhase(f.phase);
  await assert.rejects(()=>review(f,{phase:other.phase}),/this project/);
  await db.query("update daily_logs set text='Revised field evidence' where id=$1",[f.log]);
  await assert.rejects(()=>db.query('select public.review_schedule_field_progress($1,$2,$3,$4,$5,null,$6)',[f.log,f.phase,l.stamp,p.stamp,'completed','Verified']),/report changed/);
  const fresh=await getLog(f.log);await db.query("update schedule_phases set end_date='2026-10-16' where id=$1",[f.phase]);
  await assert.rejects(()=>db.query('select public.review_schedule_field_progress($1,$2,$3,$4,$5,null,$6)',[f.log,f.phase,fresh.stamp,p.stamp,'completed','Verified']),/phase changed/);
  assert.equal((await getPhase(f.phase)).status,'not_started');
});

test('roles and RPC grants block field/anonymous verification; rejected transactions leave no review',async()=>{
  const f=await fixture();await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${field}',false);`);
  await assert.rejects(()=>review(f),/Office schedule/);
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','${owner}',false);`);
  assert.equal((await one('select count(*)::int n from schedule_progress_reviews where daily_log_id=$1',[f.log])).n,0);
  for(const fn of ['review_schedule_field_progress(uuid,uuid,timestamptz,timestamptz,text,date,text,date,date)','reconcile_project_schedule(uuid,text,text)']) assert.equal((await one("select has_function_privilege('anon',$1,'execute') allowed",['public.'+fn])).allowed,false);
});

test('inspection milestones cannot be passed through a crew report',async()=>{
  const f=await fixture();const i=await one("insert into schedule_phases(project_id,name,start_date,end_date,event_type,created_by) values($1,'Final building','2026-10-15','2026-10-15','inspection',$2) returning id",[f.job,owner]);
  await assert.rejects(()=>review(f,{phase:i.id,status:'completed'}),/Inspections/);
  assert.equal((await getPhase(i.id)).status,'not_started');
});

test('verified progress excludes daily assignments and physical closeout cannot approve draft estimates',async()=>{
  const f=await fixture();await review(f,{status:'completed'});
  assert.equal((await one('select progress from projects where id=$1',[f.job])).progress,100);
  await db.query('select public.reconcile_project_schedule($1,$2,$3)',[f.job,'contracted','in_progress']);
  await db.query('select public.reconcile_project_schedule($1,$2,$3)',[f.job,'in_progress','completed']);
  const job=await one('select * from projects where id=$1',[f.job]);assert.equal(job.status,'completed');assert.equal(job.phase,'complete');assert.equal(job.contract_value,'50000');
  assert.equal((await one('select status from estimates where project_id=$1',[f.job])).status,'draft');
  await db.query('select public.reconcile_project_schedule($1,$2,$3)',[f.job,'completed','in_progress']);
  assert.equal((await one('select phase from projects where id=$1',[f.job])).phase,null);
});

test('closeout refuses incomplete work, missing plan, unresolved inspections, and stale project state',async()=>{
  const f=await fixture();await assert.rejects(()=>db.query('select public.reconcile_project_schedule($1,$2,$3)',[f.job,'contracted','completed']),/every master/);
  await assert.rejects(()=>db.query('select public.reconcile_project_schedule($1,$2,$3)',[f.job,'in_progress','completed']),/project changed/);
  await review(f,{status:'completed'});
  await db.query("insert into project_inspections(project_id,name,created_by) values($1,'Final plumbing',$2)",[f.job,owner]);
  await assert.rejects(()=>db.query('select public.reconcile_project_schedule($1,$2,$3)',[f.job,'contracted','completed']),/every master/);
});

test('client completion is verified only against a fresh, still-present report',async()=>{
  const f=await fixture();
  await db.query("update schedule_phases set client_completed_at='2026-10-16T12:00:00Z' where id=$1",[f.phase]);
  const p=await getPhase(f.phase);
  await db.query('update schedule_phases set client_completed_at=null where id=$1',[f.phase]);
  await assert.rejects(()=>db.query('select public.verify_client_schedule_progress($1,$2,$3,$4)',[f.phase,p.stamp,p.client_completed_at,'Verified with site lead']),/changed|report|withdrawn/i);
  await db.query("update schedule_phases set client_completed_at='2026-10-16T13:00:00Z' where id=$1",[f.phase]);
  const fresh=await getPhase(f.phase);
  await db.exec(`select set_config('request.jwt.claim.sub','${field}',false);`);
  await assert.rejects(()=>db.query('select public.verify_client_schedule_progress($1,$2,$3,$4)',[f.phase,fresh.stamp,fresh.client_completed_at,'Verified']),/Office/);
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`);
  await db.query('select public.verify_client_schedule_progress($1,$2,$3,$4)',[f.phase,fresh.stamp,fresh.client_completed_at,'Verified with site lead']);
  assert.equal((await getPhase(f.phase)).status,'completed');
  assert.equal((await one("select count(*)::int n from activity_log where entity_id=$1 and action='client_schedule_progress_verified'",[f.phase])).n,1);
});

test('field verification pins the displayed forecast and rejects invalid forecast ranges atomically',async()=>{
  const f=await fixture(),l=await getLog(f.log),p=await getPhase(f.phase);
  await assert.rejects(()=>db.query('select public.review_schedule_field_progress($1,$2,$3,$4,$5,null,$6,$7,$8)',[f.log,f.phase,l.stamp,p.stamp,'in_progress','Reviewed','2026-10-21','2026-10-20']),/forecast dates/);
  assert.equal((await getPhase(f.phase)).status,'not_started');
  await db.query('select public.review_schedule_field_progress($1,$2,$3,$4,$5,null,$6,$7,$8)',[f.log,f.phase,l.stamp,p.stamp,'in_progress','Reviewed','2026-10-20','2026-10-22']);
  const after=await getPhase(f.phase);
  assert.equal(new Date(after.start_date).toISOString().slice(0,10),'2026-10-20');
  assert.equal(new Date(after.end_date).toISOString().slice(0,10),'2026-10-22');
  assert.equal(new Date(after.planned_start_date).toISOString().slice(0,10),'2026-10-10');
  assert.equal(after.is_confirmed,false);assert.equal(after.is_manually_scheduled,true);
});
