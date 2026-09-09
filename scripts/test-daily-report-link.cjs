/* eslint-disable @typescript-eslint/no-require-imports */
// Run with PGlite installed outside the app (or on NODE_PATH).
// This executes the real migration against disposable PostgreSQL, never production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const author = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const job = '00000000-0000-0000-0000-000000000003';
const otherJob = '00000000-0000-0000-0000-000000000004';
let serial = 100;
let progressEnabled = false;
const progress = { status: 'remaining', remaining: 'Two rooms', timeNeeded: '2 hours', blockers: 'None' };
const id = () => `00000000-0000-0000-0000-${String(serial++).padStart(12, '0')}`;
const at = (time, date = '2026-09-08') => `${date}T${time}-04:00`;
async function insert(overrides = {}) {
  const row = { id: id(), author_id: author, project_id: job,
    started_at: at('07:00:00'), ended_at: null, status: 'in_progress',
    report_required: true, ...overrides };
  const keys = Object.keys(row);
  await db.query(`insert into daily_logs (${keys.join(',')}) values (${keys.map((_,i) => '$'+(i+1)).join(',')})`, Object.values(row));
  return row.id;
}
async function post(time = '15:16:36', overrides = {}) {
  return insert({ started_at: at(time), ended_at: at(time), status: 'completed',
    ...(progressEnabled ? { report_progress: progress } : {}),
    report_required: false, text: 'Installed baseboard; two rooms remain.',
    photo_storage_paths: ['original-photo.jpg'], ...overrides });
}
const close = (log, time = '15:16:52') => db.query(
  "update daily_logs set status='completed',ended_at=$2 where id=$1", [log, at(time)]);
const get = async log => (await db.query('select * from daily_logs where id=$1', [log])).rows[0];
const reset = () => db.exec('reset role; truncate daily_logs;');
const pending = async log => assert.equal((await get(log)).report_submitted_at, null);
const linked = async (log, report) => {
  const row = await get(log);
  assert.equal(row.daily_report_id, report);
  assert.ok(row.report_submitted_at);
};

(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create table profiles (id uuid primary key, role text);
    insert into profiles values ('${author}','field_worker'),('${other}','field_worker');
    create table daily_logs (
      id uuid primary key, author_id uuid not null, project_id uuid,
      started_at timestamptz not null, ended_at timestamptz,
      status text not null, kind text not null default 'shift', text text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      photo_storage_paths text[] not null default '{}',
      tagged_entities jsonb, mentioned_profile_ids uuid[], subcontractor_id uuid
    );
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20260905175625_deferred_daily_reports.sql', 'utf8'));

  // Reproduce Wayne's ordering against the pre-fix schema.
  const beforeShift = await insert();
  await post();
  await close(beforeShift);
  await pending(beforeShift);
  console.log('Reproduced: pre-clock-out post leaves completed shift overdue before fix.');
  await db.exec(fs.readFileSync('supabase/migrations/20260908212140_link_posts_on_clock_out.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20260908215101_require_daily_report_progress.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20260908220757_deduplicate_daily_log_photos.sql', 'utf8'));
  progressEnabled = true;
  await pending(beforeShift); // Installing the migration does not rewrite history.
  await reset();

  const unreported = await insert();
  await post('15:16:36', { text: 'Picture repost', report_progress: null });
  await close(unreported);
  await pending(unreported);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [author]);
  await assert.rejects(db.query('select submit_shift_daily_report($1,$2,$3,$4,$5,$6)',
    [author, unreported, 'Picture repost', [], '[]', []]), /Choose task status/);
  await assert.rejects(post('15:17:00', { report_progress: { ...progress, timeNeeded: '' } }), /check constraint/);
  await pending(unreported);
  await reset();

  const shift = await insert();
  const report = await post(); // Legacy kind=shift still recognized by zero duration.
  await pending(shift);
  const originalPost = await get(report);
  await close(shift);
  await linked(shift, report);
  assert.equal(Date.parse((await get(shift)).started_at), Date.parse(at('07:00:00')));
  assert.equal(Date.parse((await get(shift)).ended_at), Date.parse(at('15:16:52')));
  assert.deepEqual(await get(report), originalPost); // Text, photos and post ID untouched.
  await close(shift);
  await linked(shift, report); // Retry cannot append/duplicate anything.
  console.log('Passed: post before clock-out links without changing hours, text or photos.');

  await reset();
  const closed = await insert();
  await close(closed);
  await pending(closed);
  const latePost = await post('15:17:00', { kind: 'post' });
  await linked(closed, latePost);
  console.log('Passed: post after clock-out also links, including a stale composer.');

  await reset();
  const isolated = await insert();
  await post('15:16:36', { author_id: other });
  await post('15:16:36', { project_id: otherJob });
  await post('15:16:36', { started_at: at('15:16:36','2026-09-07'), ended_at: at('15:16:36','2026-09-07') });
  await post('15:16:36', { text: null });
  await post('15:16:36', { subcontractor_id: other });
  await close(isolated);
  await pending(isolated);
  console.log('Passed: other workers/jobs/days, photo-only and subcontractor posts cannot satisfy a report.');

  await reset();
  const first = await insert();
  await close(first, '10:00:00');
  const firstReport = await post('10:01:00');
  await linked(first, firstReport);
  const returnVisit = await insert({ started_at: at('13:00:00') });
  await close(returnVisit);
  await pending(returnVisit); // Earlier post cannot cover work done on a later visit.
  const secondReport = await post('15:20:00');
  await linked(first, firstReport);
  await linked(returnVisit, secondReport);
  await db.query('delete from daily_logs where id=$1', [secondReport]);
  await pending(returnVisit);
  assert.equal((await get(returnVisit)).daily_report_id, null);
  console.log('Passed: later visits need fresh reports; deleting a report reopens only its linked shifts.');

  await reset();
  const morning = await insert();
  await close(morning, '10:00:00');
  const afternoon = await insert({ started_at: at('13:00:00') });
  const dayReport = await post();
  await pending(morning); // No day completion while another segment is active.
  await close(afternoon);
  await linked(morning, dayReport);
  await linked(afternoon, dayReport);
  console.log('Passed: one report covers multiple closed segments of the same worker/job/day.');

  await reset();
  const nightShift = await insert({ started_at: at('20:00:00') });
  const nightReport = await post('23:50:00'); // September 9 in UTC, September 8 in Boston.
  await close(nightShift, '23:55:00');
  await linked(nightShift, nightReport);
  console.log('Passed: workday grouping uses America/New_York, not UTC.');

  await reset();
  await db.exec(`
    alter table daily_logs enable row level security;
    create policy read_logs on daily_logs for select to authenticated using (true);
    create policy insert_logs on daily_logs for insert to authenticated with check (author_id=auth.uid());
    create policy update_logs on daily_logs for update to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid());
    grant usage on schema public,auth to authenticated;
    grant select,insert,update,delete on daily_logs to authenticated;
    grant select on profiles to authenticated;
    select set_config('request.jwt.claim.sub','${author}',false);
    set role authenticated;
  `);
  const own = await insert();
  const ownPost = await post();
  await close(own);
  await linked(own, ownPost);
  await db.query('select append_daily_log_photo($1,$2)',[ownPost,'retry-photo.jpg']);
  await db.query('select append_daily_log_photo($1,$2)',[ownPost,'retry-photo.jpg']);
  assert.equal((await get(ownPost)).photo_storage_paths.filter(p=>p==='retry-photo.jpg').length,1);
  await assert.rejects(post('15:16:36', { author_id: other }), /row-level security/);
  console.log('Passed: trigger works with authenticated worker RLS and cannot write another worker\'s post.');

  await reset();
  const explicit = await insert();
  await close(explicit);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [author]);
  await db.query('select submit_shift_daily_report($1,$2,$3,$4,$5,$6,$7)',
    [author, explicit, 'Finished work; no blockers.', [], '[]', [], progress]);
  await linked(explicit, explicit);
  const explicitPost = await get(explicit);
  await db.query('select submit_shift_daily_report($1,$2,$3,$4,$5,$6,$7)',
    [author, explicit, 'Finished work; no blockers.', [], '[]', [], progress]);
  assert.deepEqual(await get(explicit), explicitPost);
  console.log('Passed: existing explicit report submission and retries still work.');
  await db.exec(fs.readFileSync('supabase/migrations/20260909000946_narrative_daily_reports.sql', 'utf8'));
  await reset();
  const narrativeShift = await insert();
  const narrativePost = await post('15:16:36', {report_progress: {mode:'narrative'}});
  await pending(narrativeShift);
  await close(narrativeShift);
  await linked(narrativeShift, narrativePost);
  await reset();
  const afterClockOut = await insert();
  await close(afterClockOut);
  const savedShift = await get(afterClockOut);
  await db.query('select submit_shift_daily_report($1,$2,$3,$4,$5,$6,$7)',
    [author, afterClockOut, 'Installed trim; one room remains tomorrow.', ['test-photo.jpg'], '[]', [], {mode:'narrative'}]);
  await linked(afterClockOut, afterClockOut);
  const savedReport = await get(afterClockOut);
  assert.deepEqual(savedReport.report_progress, {mode:'narrative'});
  assert.equal(savedReport.started_at.toISOString(), savedShift.started_at.toISOString());
  assert.equal(savedReport.ended_at.toISOString(), savedShift.ended_at.toISOString());
  assert.deepEqual(savedReport.photo_storage_paths, ['test-photo.jpg']);
  assert.ok(!savedReport.text.includes('Task status:'));
  await reset();
  const quickShift = await insert();
  await post('15:16:36', {report_progress:null});
  await close(quickShift);
  await pending(quickShift);
  console.log('Passed: narrative reports link in both orders, preserve time/photos, do not invent completion; quick updates stay excluded.');
  await db.close();
})().catch(async error => { console.error(error); await db.close(); process.exitCode = 1; });
