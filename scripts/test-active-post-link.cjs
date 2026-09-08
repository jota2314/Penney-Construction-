const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create table schedule_phases(id text primary key, project_id text, estimate_line_item_id text);
    create table daily_logs(id serial primary key, author_id text, project_id text,
      subcontractor_id text, schedule_phase_id text, estimate_line_item_id text,
      report_required boolean default false, report_submitted_at timestamptz,
      status text default 'completed', started_at timestamptz default now(),
      ended_at timestamptz default now(), line_item_needs_review boolean default false);
    insert into schedule_phases values ('phase','job','wallpaper');
    alter table daily_logs enable row level security;
    create policy own on daily_logs to authenticated using(author_id=current_setting('test.author')) with check(author_id=current_setting('test.author'));
    grant select,insert,update on daily_logs to authenticated;
    grant usage,select on sequence daily_logs_id_seq to authenticated;
    grant select on schedule_phases to authenticated;`);
  await db.exec(fs.readFileSync('supabase/migrations/20260908225545_link_active_task_on_post.sql','utf8'));
  await db.exec(`insert into daily_logs(author_id,project_id,status,ended_at,schedule_phase_id,estimate_line_item_id,report_required) values
    ('brian','job','in_progress',null,'phase','wallpaper',true),
    ('other','job','in_progress',null,'other-phase','framing',true);
    set role authenticated; set test.author='brian';`);
  const post = async (job='job', line=null) => (await db.query(`insert into daily_logs(author_id,project_id,estimate_line_item_id) values ('brian',$1,$2) returning *`,[job,line])).rows[0];
  const photo = await post();
  assert.equal(photo.schedule_phase_id,'phase'); assert.equal(photo.estimate_line_item_id,'wallpaper');
  assert.equal(photo.report_submitted_at,null); assert.equal(photo.report_required,false);
  const differentJob=await post('elsewhere'); assert.equal(differentJob.estimate_line_item_id,null); assert.equal(differentJob.line_item_needs_review,true);
  const explicit=await post('job','explicit'); assert.equal(explicit.estimate_line_item_id,'explicit');
  await db.exec(`update daily_logs set status='completed',ended_at=now() where status='in_progress';`);
  const closed=await post(); assert.equal(closed.estimate_line_item_id,null);
  await db.exec(`insert into daily_logs(author_id,project_id,status,ended_at,schedule_phase_id,report_required) values ('brian','job','in_progress',null,'phase',true);`);
  assert.equal((await post()).estimate_line_item_id,'wallpaper');
  await db.exec(`insert into daily_logs(author_id,project_id,status,ended_at,report_required) values ('brian','job','in_progress',null,true);`);
  const ambiguous=await post(); assert.equal(ambiguous.estimate_line_item_id,null); assert.equal(ambiguous.line_item_needs_review,true);
  await db.close();
  console.log('PASS: old-client photo post inherits active task under RLS; other workers/jobs isolated; explicit allocation preserved; closed/ambiguous shifts not guessed; phase fallback; report obligation untouched.');
})().catch(e=>{console.error(e);process.exitCode=1;});
