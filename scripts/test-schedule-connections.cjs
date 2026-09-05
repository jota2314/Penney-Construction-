/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS regression checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}) {
  const context = { exports: {}, require: name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/')) return load(path.join('src', name.slice(2) + '.ts'), mocks);
    if (name.startsWith('.')) return load(path.join(path.dirname(file), name + '.ts'), mocks);
    return require(name);
  }};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}
const { actualWorkByDay } = load('src/lib/board/actual-work.ts');
const now = Date.parse('2026-09-05T16:00:00Z');
const base = { id: 'shift', author_id: 'worker', project_id: 'job', estimate_line_item_id: 'line', started_at: '2026-09-05T12:00:00Z', ended_at: null, status: 'in_progress' };
const employees = [{ id: 'emp', profile_id: 'worker' }];
const plans = { 'emp:emp': { '2026-09-05': [{ projectId: 'job', confirmed: true }] } };
const build = (logs, plan = plans) => actualWorkByDay(logs, employees, new Map([['job', 'Actual job']]), new Map([['line', 'Framing']]), plan, now);
let actual = build([base])['emp:emp']['2026-09-05'][0];
assert.equal(actual.projectName, 'Actual job');
assert.equal(actual.task, 'Framing');
assert.equal(actual.clockedIn, true);
assert.equal(actual.differsFromPlan, false);
assert.equal(build([base], {})['emp:emp']['2026-09-05'][0].differsFromPlan, true);
assert.equal(build([base, base])['emp:emp']['2026-09-05'].length, 1);
assert.equal(Object.keys(build([{ ...base, ended_at: base.started_at }])).length, 0);
assert.equal(Object.keys(build([{ ...base, author_id: 'someone-else' }])).length, 0);
assert.equal(build([{ ...base, started_at: '2026-09-05T01:00:00Z' }])['emp:emp']['2026-09-04'][0].clockedIn, false);
assert.equal(build([{ ...base, status: 'completed', ended_at: '2026-09-05T15:00:00Z', text: 'Remaining: trim' }])['emp:emp']['2026-09-05'][0].notes, 'Remaining: trim');
assert.equal(plans['emp:emp']['2026-09-05'][0].projectId, 'job');
const { groupPendingReports } = load('src/lib/crew/pending-reports.ts');
const shift = { id: 'a', project_id: 'job', started_at: '2026-09-04T12:00:00Z', ended_at: '2026-09-04T13:00:00Z', report_required: true, report_submitted_at: null, status: 'completed' };
const pending = groupPendingReports([shift, { ...shift, id: 'b' }, { ...shift, id: 'old', report_required: false }, { ...shift, id: 'submitted', report_submitted_at: '2026-09-04T20:00Z' }, { ...shift, id: 'photo', ended_at: shift.started_at }], new Map([['job','Test job']]), '2026-09-05');
assert.equal(pending.length, 1);
assert.equal(pending[0].minutes, 120);
assert.equal(pending[0].overdue, true);
assert.equal(groupPendingReports([shift], new Map(), '2026-09-04')[0].overdue, false);
assert.equal(groupPendingReports([{ ...shift, started_at: '2026-09-05T01:00Z', ended_at: '2026-09-05T02:00Z' }], new Map(), '2026-09-05')[0].workDate, '2026-09-04');
const { uncoveredChangeOrders } = load('src/lib/schedule/change-order-coverage.ts');
const orders = [{ id: 'co', status: 'approved' }, { id: 'draft', status: 'draft' }];
const lines = [{ id: 'line', change_order_id: 'co' }, { id: 'line2', change_order_id: 'co' }];
assert.equal(uncoveredChangeOrders(orders, lines, []).length, 1);
assert.equal(uncoveredChangeOrders(orders, lines, [{ phase_scope: 'daily', estimate_line_item_id: 'line' }])[0].missingLineIds.length, 2);
assert.equal(uncoveredChangeOrders(orders, lines, [{ phase_scope: 'master', estimate_line_item_id: 'line' }])[0].missingLineIds[0], 'line2');
assert.equal(uncoveredChangeOrders(orders, lines, lines.map(l => ({ phase_scope: 'master', estimate_line_item_id: l.id }))).length, 0);
assert.equal(uncoveredChangeOrders(orders, [], [])[0].noBudgetLink, true);

const { slippedDates } = load('src/lib/schedule/slip-dates.ts');
assert.equal(slippedDates({start_date:'2026-09-01',end_date:'2026-09-04',status:'completed'},2,'2026-09-05'),null);
assert.equal(slippedDates({start_date:'2026-09-01',end_date:'2026-09-04',status:'in_progress'},2,'2026-09-05'),null);
assert.equal(slippedDates({start_date:'2026-09-01',end_date:'2026-09-08',status:'in_progress'},2,'2026-09-05').start_date,'2026-09-01');
assert.equal(slippedDates({start_date:'2026-09-08',end_date:'2026-09-09',status:'not_started'},2,'2026-09-05').start_date,'2026-09-10');
assert.equal(slippedDates({start_date:'2026-09-08',end_date:'2026-09-09',status:'not_started'},1.5,'2026-09-05'),null);
(async () => {
  let write, filters = [], authenticated = true;
  const revalidated = [];
  const builder = { select() { return this; }, update(value) { write = value; filters = []; return this; }, eq(key, value) { filters.push([key, value]); return this; }, single: async () => ({ data: { text: 'Existing field note' } }), maybeSingle: async () => ({ data: { id: 'shift' }, error: null }), then(resolve) { resolve({ data: { id: 'shift' }, error: null }); } };
  const mocks = new Proxy({
    '@/lib/supabase/server': { createClient: async () => ({ from: table => { assert.equal(table, 'daily_logs'); return builder; } }) },
    '@/lib/auth/get-user': { getUser: async () => authenticated ? { id: 'office', profile: { id: 'worker' } } : null },
    '@/lib/actions/daily-reports': { dailyReportClockInError: async () => 'Finish prior daily log' },
    'next/cache': { revalidatePath: p => revalidated.push(p) },
    zod: require('zod'),
  }, { has: () => true, get: (target, key) => target[key] ?? {} });
  const { clockOutWithLog, clockInOnPhase, clockInOnLineItem, clockInGeneral } = load('src/lib/actions/daily-logs.ts', mocks);
  assert.equal((await clockInOnPhase('phase')).error, 'Finish prior daily log');
  assert.equal((await clockInOnLineItem('job','line')).error, 'Finish prior daily log');
  assert.equal((await clockInGeneral('job')).error, 'Finish prior daily log');
  await clockOutWithLog('shift');
  assert.equal('text' in write, false);
  assert.equal('photo_storage_paths' in write, false);
  assert.equal(write.status, 'completed');
  assert.equal(write.report_required, true);
  assert.equal('report_submitted_at' in write, false);
  assert.ok(filters.some(([key, value]) => key === 'author_id' && value === 'worker'));
  assert.ok(revalidated.includes('/board'));
  await clockOutWithLog('shift', undefined, undefined, { finished: 'Demo', remaining: 'Framing, one day', blocked: 'Inspection' });
  assert.equal(write.text, 'Existing field note\n\nFinished: Demo\nRemaining: Framing, one day\nBlocked by: Inspection');
  assert.equal('photo_storage_paths' in write, false);
  assert.ok((await clockOutWithLog('shift', undefined, undefined, { finished: 'x'.repeat(1501), remaining: '', blocked: '' })).error);
  authenticated = false;
  assert.ok((await clockOutWithLog('shift')).error);
  console.log('Schedule connection checks passed: actual vs planned, scope coverage, local work dates, note preservation, effective user and validation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
