import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Execute the actual shared TypeScript modules, including their pure dependencies.
const cache = new Map();
const root = fileURLToPath(new URL('..', import.meta.url));
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = (specifier) => load(path.relative(root, path.resolve(path.dirname(filename), `${specifier}.ts`)));
  new Function('require', 'module', 'exports', source)(require, module, module.exports);
  return module.exports;
}
const { deriveScheduleHealth, deriveCurrentScheduleActivity, recentWorkDates, scheduleStartLabel } = load('src/lib/schedule/health.ts');
const { withEffectiveScheduleDates } = load('src/lib/schedule/cascade.ts');
const today = '2026-10-16';
const now = Date.parse('2026-10-16T18:00:00Z');
const master = (patch = {}) => ({ id: 'phase', name: 'Kitchen framing', phase_scope: 'master', event_type: 'phase', status: 'not_started', start_date: today, end_date: today, sort_order: 0, is_confirmed: false, is_manually_scheduled: false, planned_start_date: null, planned_end_date: null, ...patch });
const health = (phases, patch = {}) => deriveScheduleHealth({ phases, status: 'in_progress', today, ...patch });

test('daily dispatch cannot conceal a missing construction plan on a contracted working job', () => {
  const phases = [master({ phase_scope: 'daily', event_type: 'crew', start_date: '2026-10-17', end_date: '2026-10-17' })];
  const result = health(phases, { status: 'contracted', recentWorkDates: ['2026-10-15'] });
  assert.equal(result.masterCount, 0);
  assert.equal(result.missingMaster, true);
  assert.equal(result.workStartedStatusMismatch, true);
  assert.deepEqual(result.issues.map(i => i.code), ['work_status', 'missing_master']);
});

test('all preconstruction statuses surface recent field work without promoting status', () => {
  for (const status of ['lead', 'estimating', 'waiting_for_approval', 'proposal_sent', 'contracted']) {
    const input = { phases: [], status, today, recentWorkDates: ['2026-10-15'] };
    assert.equal(deriveScheduleHealth(input).workStartedStatusMismatch, true);
    assert.equal(input.status, status);
  }
  assert.equal(health([], { status: 'estimating' }).missingMaster, false);
  assert.equal(health([], { status: 'audit', recentWorkDates: ['2026-10-15'] }).workStartedStatusMismatch, false);
});

test('only unfinished master work contributes overdue and remaining-plan warnings', () => {
  const phases = [
    master({ id: 'late', start_date: '2026-10-01', end_date: '2026-10-02' }),
    master({ id: 'legacy', phase_scope: null, start_date: '2026-10-03', end_date: '2026-10-04' }),
    master({ id: 'done', status: 'completed', start_date: '2026-10-01', end_date: '2026-10-02' }),
    master({ id: 'crew', event_type: 'crew', phase_scope: 'daily', start_date: '2026-10-20', end_date: '2026-10-20' }),
    master({ id: 'cancelled', status: 'cancelled', start_date: '2026-10-01', end_date: '2026-10-02' }),
    master({ id: 'clock', name: 'Needs allocation', phase_scope: 'daily', status: 'in_progress', start_date: '2026-10-01', end_date: '2026-10-01' }),
  ];
  const result = health(phases);
  assert.equal(result.overdueCount, 2);
  assert.equal(result.nothingAhead, true);
  assert.deepEqual(result.overduePhases.map(p => p.id), ['late', 'legacy']);
  assert.ok(result.issues.some(i => i.code === 'nothing_ahead'));
});

test('completion flags use verified master status and never close a project', () => {
  assert.equal(health([master({ status: 'completed' })]).readyToClose, true);
  assert.equal(health([master({ status: 'not_started', client_completed: true })]).readyToClose, false);
  assert.equal(health([], { status: 'in_progress' }).readyToClose, false);
  const reopened = health([master()], { status: 'completed' });
  assert.equal(reopened.completedOpenWork, true);
  assert.ok(reopened.issues.some(i => i.code === 'completed_open_work'));
});

test('real-work evidence excludes uploads, invalid shifts, future logs and old attendance', () => {
  const log = (patch = {}) => ({ started_at: '2026-10-15T12:00:00Z', ended_at: '2026-10-15T17:00:00Z', status: 'completed', ...patch });
  assert.deepEqual(recentWorkDates([
    log(),
    log({ started_at: '2026-10-16T12:00:00Z', ended_at: null, status: 'in_progress' }),
    log({ started_at: '2026-10-14T12:00:00Z', ended_at: '2026-10-14T12:00:00Z' }),
    log({ started_at: '2026-10-13T12:00:00Z', ended_at: null, status: 'completed' }),
    log({ started_at: '2026-10-12T12:00:00Z', ended_at: null, status: 'in_progress' }),
    log({ started_at: '2026-08-01T12:00:00Z', ended_at: '2026-08-01T13:00:00Z' }),
    log({ started_at: '2026-10-17T12:00:00Z', ended_at: '2026-10-17T13:00:00Z' }),
  ], today, now), ['2026-10-15', '2026-10-16']);
});

test('current and next work exclude completed, held and clock-in rows and prefer the master plan', () => {
  const phases = [
    master({ id: 'done', status: 'completed', end_date: '2026-10-20' }),
    master({ id: 'clock', phase_scope: 'daily', status: 'in_progress', name: 'Needs allocation' }),
    master({ id: 'legacy-clock', status: 'in_progress', name: 'Clock in - crew' }),
    master({ id: 'held', status: 'on_hold' }),
    master({ id: 'crew', phase_scope: 'daily', event_type: 'crew', name: 'A crew assignment' }),
    master({ id: 'current', status: 'in_progress', name: 'Real master work' }),
    master({ id: 'done-next', status: 'completed', start_date: '2026-10-17', end_date: '2026-10-17' }),
    master({ id: 'next', start_date: '2026-10-18', end_date: '2026-10-18' }),
  ];
  const result = deriveCurrentScheduleActivity(phases, today);
  assert.equal(result.current.id, 'current');
  assert.equal(result.next.id, 'next');
});

test('health and current work consume the same effective master dates as the timeline', () => {
  const phases = [
    master({ id: 'anchor', status: 'in_progress', sort_order: 1, start_date: '2026-10-12', end_date: '2026-10-14', planned_start_date: '2026-10-05', planned_end_date: '2026-10-07' }),
    master({ id: 'next', sort_order: 2, start_date: '2026-10-09', end_date: '2026-10-10', planned_start_date: '2026-10-09', planned_end_date: '2026-10-10' }),
  ];
  const effective = withEffectiveScheduleDates(phases);
  assert.equal(effective[1].start_date, today);
  assert.equal(deriveCurrentScheduleActivity(effective, today).current.id, 'next');
  assert.equal(health(effective).nothingAhead, false);
  assert.equal(health(effective).overdueCount, 1);
});

test('a historical start date never says Starts today', () => {
  assert.equal(scheduleStartLabel(-14), 'Start date passed 14d ago');
  assert.equal(scheduleStartLabel(0), 'Starts today');
  assert.equal(scheduleStartLabel(3), 'Starts in 3d');
});
