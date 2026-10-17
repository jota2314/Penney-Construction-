/* eslint-disable @typescript-eslint/no-require-imports */
// No network or production writes: all action/portal database boundaries are mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
let runtimeRequire = require;
try { require.resolve('typescript'); } catch {
  runtimeRequire = createRequire(path.resolve('../pc-contract/package.json'));
}
const ts = runtimeRequire('typescript');
const cache = new Map();
function load(file, mocks = {}, useCache = false) {
  if (useCache && cache.has(file)) return cache.get(file);
  const context = { exports: {}, console, process, Date, setTimeout, require(name) {
    if (name in mocks) return mocks[name];
    if (name === 'server-only') return {};
    if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts', mocks, useCache);
    if (name.startsWith('.')) return load(path.join(path.dirname(file), name + '.ts'), mocks, useCache);
    return runtimeRequire(name);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context, { filename: file });
  if (useCache) cache.set(file, context.exports);
  return context.exports;
}
const copy = value => JSON.parse(JSON.stringify(value));
const { cascadeSchedule, withEffectiveScheduleDates, stabilizePhaseDates } = load('src/lib/schedule/cascade.ts');
const { checkSequence, inferDependencies } = load('src/lib/schedule/sequence-check.ts');
const { scheduleDatePatch, isCalendarDate } = load('src/lib/schedule/date-patch.ts');
const { inspectionCompletionDay } = load('src/lib/schedule/inspection-completion-day.ts');
const job = '11111111-1111-4111-8111-111111111111';
const phase = {
  id: 'phase', project_id: job, name: 'Plaster', phase_scope: 'master', event_type: 'phase',
  sort_order: 2, status: 'not_started', is_confirmed: false, is_manually_scheduled: false,
  start_date: '2026-10-20', end_date: '2026-10-21',
  planned_start_date: '2026-10-20', planned_end_date: '2026-10-21',
  assigned_employee_ids: [], assigned_sub_ids: [],
};
const inspection = {
  ...phase, id: 'inspection', name: 'Electrical Inspection', event_type: 'inspection', sort_order: 1,
  is_confirmed: true, start_date: '2026-10-21', end_date: '2026-10-21',
  planned_start_date: '2026-10-18', planned_end_date: '2026-10-18',
};

assert.equal(isCalendarDate('2026-02-30'), false);
assert.equal(isCalendarDate('2028-02-29'), true);
assert.deepEqual(copy(scheduleDatePatch({ start_date: '2026-10-23', end_date: '2026-10-24' }, phase)), {
  start_date: '2026-10-23', end_date: '2026-10-24', is_manually_scheduled: true,
});
assert.equal('is_manually_scheduled' in scheduleDatePatch({ start_date: phase.start_date, end_date: phase.end_date }, phase), false);
assert.equal(scheduleDatePatch({ start_date: phase.start_date, is_manually_scheduled: true }, phase).is_manually_scheduled, true);
assert.equal(scheduleDatePatch({ is_manually_scheduled: false }, phase).is_manually_scheduled, false);

// End-only overrun moves only originally subsequent tentative work; fixed and
// actual dates, concurrent activities, overhead and separate rooms stay put.
const rough = { ...phase, id: 'rough', name: 'Rough Electrical — Kitchen', sort_order: 0,
  status: 'in_progress', start_date: '2026-10-12', end_date: '2026-10-19',
  planned_start_date: '2026-10-12', planned_end_date: '2026-10-15' };
const after = { ...phase, name: 'Plaster — Kitchen' };
assert.equal(cascadeSchedule([rough, after]).get('phase').start_date, '2026-10-24');
assert.equal(cascadeSchedule([rough, { ...after, is_manually_scheduled: true }]).get('phase').start_date, '2026-10-20');
for (const status of ['completed', 'in_progress']) {
  assert.equal(cascadeSchedule([rough, { ...after, status }]).get('phase').start_date, '2026-10-20');
}
assert.equal(cascadeSchedule([rough, { ...after, is_confirmed: true }]).get('phase').start_date, '2026-10-20');
const overlap = { ...after, start_date: '2026-10-14', planned_start_date: '2026-10-14' };
assert.equal(cascadeSchedule([rough, overlap]).get('phase').start_date, '2026-10-14');
assert.equal(cascadeSchedule([{ ...rough, name: 'Dumpsters (2)' }, after]).get('phase').start_date, '2026-10-20');
assert.equal(cascadeSchedule([rough, { ...after, name: 'Dumpsters (2)' }]).get('phase').start_date, '2026-10-20');
assert.equal(cascadeSchedule([rough, { ...after, name: 'Paint — Bathroom' }]).get('phase').start_date, '2026-10-20');
assert.equal(cascadeSchedule([{ ...rough, end_date: '2026-10-14' }, after]).get('phase').start_date, '2026-10-20');
const original = copy([inspection, phase]);
// Legacy date-only records have midnight-UTC sentinels, not observed instants.
assert.equal(inspectionCompletionDay('2026-10-09T00:00:00+00:00'), '2026-10-09');
assert.equal(inspectionCompletionDay('2026-10-14T00:00:00.000Z'), '2026-10-14');
assert.equal(inspectionCompletionDay('2026-10-14T01:00:00Z'), '2026-10-13');
assert.equal(inspectionCompletionDay('2026-10-14T16:00:00Z'), '2026-10-14');
assert.equal(inspectionCompletionDay('invalid'), null);
const passed = { ...inspection, status: 'completed', actual_completed_at: '2026-10-14T00:00:00+00:00' };
const actual = cascadeSchedule([passed]).get('inspection');
assert.equal(actual.start_date, '2026-10-14');
assert.equal(actual.end_date, '2026-10-14');
assert.equal(actual.actual_completion_date, '2026-10-14');
assert.equal(passed.start_date, '2026-10-21'); // booking stays unchanged
assert.equal(cascadeSchedule([{ ...passed, actual_completed_at: null }]).get('inspection').start_date, '2026-10-21');
assert.equal(stabilizePhaseDates([{ ...inspection, is_confirmed: false }], 'inspection', { status: 'completed' }), null);
const effective = withEffectiveScheduleDates(original);
assert.equal(effective[1].start_date, '2026-10-23');
assert.equal(original[1].start_date, '2026-10-20');
assert.equal(checkSequence(original).some(i => i.rule === 'close-in-before-inspection'), true);
assert.equal(checkSequence(effective).some(i => i.rule === 'close-in-before-inspection'), false);
const firstFirm = stabilizePhaseDates(original, 'phase', { status: 'in_progress' });
assert.equal(firstFirm.start_date, '2026-10-23');
assert.equal(cascadeSchedule([inspection, { ...phase, ...firstFirm, status: 'in_progress' }]).get('phase').start_date, '2026-10-23');
assert.equal(stabilizePhaseDates([rough, { ...phase, status: 'completed' }], 'phase', { status: 'in_progress' }), null);
const cabinets = { ...phase, id: 'cabinets', name: 'Cabinets — Kitchen', end_date: '2026-10-25' };
const counters = { ...phase, id: 'counters', name: 'Countertops — Kitchen', start_date: '2026-10-23', end_date: '2026-10-23', is_manually_scheduled: true };
assert.equal(checkSequence([cabinets, counters]).some(i => i.rule === 'dependency-readiness'), true);
assert.equal(inferDependencies([cabinets, { ...counters, name: 'Countertops — Bathroom' }]).length, 0);

// Calendar dates must not change when code runs in another time zone or at DST.
const oldTZ = process.env.TZ;
for (const tz of ['UTC', 'America/New_York', 'Pacific/Auckland']) {
  process.env.TZ = tz;
  const dst = { ...phase, start_date: '2026-11-01', end_date: '2026-11-02', planned_start_date: '2026-11-01', planned_end_date: '2026-11-02' };
  assert.equal(cascadeSchedule([dst]).get('phase').start_date, '2026-11-01');
}
if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ;

const writes = [], invalidated = [];
let rows = [copy(phase)], writeError = null, loggedIn = true;
function db() {
  return {
    auth: { getUser: async () => ({ data: { user: loggedIn ? { id: 'actor' } : null } }) },
    from(table) {
      let filters = [], patch, columns, inserted;
      const query = {
        select(value) { columns = value; return this; },
        eq(key, value) { filters.push([key, value]); return this; },
        or() { return this; }, order() { return this; }, neq() { return this; },
        update(value) { patch = copy(value); return this; },
        insert(value) { inserted = copy(value); return this; },
        single() { return Promise.resolve(result(true)); },
        then(resolve) { return Promise.resolve(result(false)).then(resolve); },
      };
      function result(single) {
        assert.equal(table, 'schedule_phases');
        if (inserted) {
          const saved = { ...inserted, id: 'new-phase' };
          rows.push(saved); writes.push(copy(saved));
          return { data: saved, error: writeError };
        }
        const found = rows.filter(row => filters.every(([key, value]) => row[key] === value));
        if (patch) {
          if (!writeError) for (const row of found) { Object.assign(row, patch); writes.push({ id: row.id, ...patch }); }
          return { data: single ? found[0] : found, error: writeError };
        }
        const projection = found.map(row => Object.fromEntries(columns.split(',').map(key => key.trim()).map(key => [key, row[key]])));
        return { data: single ? projection[0] ?? null : projection, error: null };
      }
      return query;
    },
  };
}
const sharedMocks = {
  '@/lib/supabase/server': { createClient: async () => db() },
  '@/lib/estimates/current': {},
  '@/lib/google/calendar': { createEvent: async () => ({ id: 'mock-event' }) },
  '@/lib/notifications/schedule-notify': {
    notifySchedulePhaseAssignees: async () => ({ emailed: [], skipped: [], pushed: 0 }),
    formatShortRange: (a, b) => `${a}–${b}`,
  },
  '@/lib/crew/schedule-dates': { crewToday: () => '2026-10-16' },
  'next/cache': { revalidatePath: (route, type) => invalidated.push([route, type]) },
};

async function actionChecks() {
  const { updateSchedulePhase, createSchedulePhase } = load('src/lib/actions/schedule.ts', sharedMocks);
  await updateSchedulePhase('phase', { project_id: job, start_date: '2026-10-23', end_date: '2026-10-24' });
  assert.equal(rows[0].is_manually_scheduled, true);
  assert.equal(cascadeSchedule(rows).get('phase').start_date, '2026-10-23');
  assert.equal(rows[0].planned_start_date, '2026-10-20');
  assert.equal(rows[0].is_confirmed, false);
  assert.equal(writes.some(w => 'planned_start_date' in w), false);
  assert.equal(invalidated.some(([p]) => p === '/board'), true);
  assert.equal(invalidated.some(([p, t]) => p === '/portal/[token]' && t === 'page'), true);
  rows = [copy(phase)]; writes.length = 0;
  await updateSchedulePhase('phase', { project_id: job, notes: 'Review later' });
  assert.equal(rows[0].is_manually_scheduled, false);
  assert.equal((await updateSchedulePhase('phase', { project_id: job, start_date: '2026-10-30' })).error, 'End date must be on or after the start date.');
  assert.ok((await updateSchedulePhase('phase', { project_id: job, start_date: '2026-02-30' })).error);
  assert.ok((await updateSchedulePhase('phase', { project_id: '22222222-2222-4222-8222-222222222222', status: 'completed' })).error);
  writeError = { message: 'Denied' };
  assert.equal((await updateSchedulePhase('phase', { project_id: job, notes: 'No save' })).error, 'Denied');
  writeError = null; loggedIn = false;
  assert.equal((await updateSchedulePhase('phase', { project_id: job, status: 'completed' })).error, 'Not authenticated');
  loggedIn = true;
  rows = copy([inspection, phase]);
  await updateSchedulePhase('phase', { project_id: job, status: 'in_progress' });
  assert.equal(rows[1].start_date, '2026-10-23');
  assert.equal(rows[1].planned_start_date, '2026-10-20');
  const created = await createSchedulePhase({ project_id: job, name: 'Building inspection', event_type: 'inspection', phase_scope: 'daily', start_date: '2026-10-28', end_date: '2026-10-28' });
  assert.equal(created.error, null);
  assert.equal(created.data.phase_scope, 'master');
  assert.equal(created.data.is_manually_scheduled, true);
  assert.equal(created.data.planned_start_date, '2026-10-28');
  assert.ok((await createSchedulePhase({ project_id: job, name: 'Invalid date', start_date: '2026-02-30', end_date: '2026-03-01' })).error);

  const { slipProjectSchedule } = load('src/lib/actions/schedule-slip.ts', sharedMocks);
  const doneAnchor = { ...inspection, status: 'completed' };
  const daily = { ...phase, id: 'daily', phase_scope: 'daily', sort_order: 0, is_confirmed: true };
  rows = copy([doneAnchor, phase, daily]); writes.length = 0;
  const result = await slipProjectSchedule(job, 2);
  assert.equal(result.shifted, 1);
  assert.equal(rows.find(p => p.id === 'phase').start_date, '2026-10-25'); // Oct23 forecast +2
  assert.equal(rows.find(p => p.id === 'phase').is_manually_scheduled, true);
  assert.equal(cascadeSchedule(rows.filter(p => p.phase_scope === 'master')).get('phase').start_date, '2026-10-25');
  assert.equal(rows.find(p => p.id === 'inspection').start_date, '2026-10-21');
  assert.equal(rows.find(p => p.id === 'daily').start_date, '2026-10-20');
  assert.equal((await slipProjectSchedule(job, 1.5)).shifted, 0);
  writeError = { message: 'Denied' };
  assert.ok((await slipProjectSchedule(job, 2)).error);
  writeError = null;
}

async function portalChecks() {
  const fixture = process.env.SCHEDULE_DATE_FIXTURE
    ? JSON.parse(fs.readFileSync(process.env.SCHEDULE_DATE_FIXTURE, 'utf8').replace(/^\uFEFF/, ''))
    : [passed, { ...phase, ...scheduleDatePatch({ start_date: '2026-10-28', end_date: '2026-10-29' }, phase) }];
  // Match PostgREST projection: an omitted query field really is omitted here.
  const portalDb = { from(table) {
    let columns = '';
    const query = {
      select(value) { columns = value; return this; },
      eq() { return this; }, or() { return this; }, not() { return this; }, neq() { return this; },
      order() { return this; }, limit() { return this; }, lte() { return this; }, gte() { return this; },
      is() { return this; }, in() { return this; },
      single() { return Promise.resolve({ data: { name: 'Schedule regression', status: 'in_progress', contract_value: 0 } }); },
      then(resolve) {
        const data = table === 'schedule_phases' && columns.includes('planned_start_date')
          ? fixture.map(row => Object.fromEntries(columns.split(',').map(k => k.trim()).map(k => [k, row[k]]))) : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return query;
  } };
  const { loadPortalData } = load('src/lib/portal/load-portal-data.ts', {
    '@/lib/image/transform-signed-url': {}, '@/lib/storage/signed-url-cache': {},
  });
  const result = await loadPortalData(portalDb, { projectId: job, mode: 'client', token: 'fixture' });
  const office = cascadeSchedule(fixture);
  for (const row of result.schedule) {
    assert.equal(row.start_date, office.get(row.id).start_date, `${row.id} start differs between portal and office`);
    assert.equal(row.end_date, office.get(row.id).end_date, `${row.id} end differs between portal and office`);
  }
  assert.equal(result.schedule.length, fixture.length);
  console.log(`Portal/staff parity verified for ${fixture.length} phases.`);
}

async function aiChecks() {
  // Only the shared handler's date and invalidation imports run; all integrations
  // are stubs. No model call, calendar write, notification or email is possible.
  const mocks = new Proxy(sharedMocks, {
    has: (target, key) => key in target || !String(key).startsWith('@/lib/schedule/'),
    get: (target, key) => target[key] ?? {},
  });
  const { executeTool } = load('src/lib/ai/shared-tool-handlers.ts', mocks);
  rows = [copy(phase)];
  let result = JSON.parse(await executeTool('update_schedule_phase', { phase_id: 'phase', start_date: '2026-10-27', end_date: '2026-10-28' }, db()));
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(rows[0].is_manually_scheduled, true);
  assert.equal(rows[0].planned_start_date, '2026-10-20');
  result = JSON.parse(await executeTool('create_schedule_phase', { project_id: job, name: 'Electrical Inspection', event_type: 'inspection', start_date: '2026-10-28' }, db(), 'actor'));
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(rows.at(-1).phase_scope, 'master');
  assert.equal(rows.at(-1).is_manually_scheduled, true);
  result = JSON.parse(await executeTool('create_schedule_phase', { project_id: job, name: 'Crew visit', start_date: '2026-10-28', phase_scope: 'daily' }, db(), 'actor'));
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(rows.at(-1).phase_scope, 'daily');
  result = JSON.parse(await executeTool('create_schedule_phase', { project_id: job, name: 'Cabinet installation', start_date: '2026-10-28', phase_scope: 'master' }, db(), 'actor'));
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(rows.at(-1).phase_scope, 'master');
}

async function reviewChecks() {
  const phaseId = '33333333-3333-4333-8333-333333333333';
  const stamp = '2026-10-16T12:00:00Z';
  rows = copy([inspection, { ...phase, id: phaseId, updated_at: stamp }]);
  let called;
  const database = db();
  const scheduleFrom = database.from;
  database.from = table => table === 'daily_logs' ? {
    select() { return this; }, eq() { return this; }, single: async () => ({ data: { project_id: job }, error: null }),
  } : scheduleFrom(table);
  database.rpc = async (name, args) => { called = { name, args }; return { error: null }; };
  const review = load('src/lib/actions/schedule-review.ts', {
    ...sharedMocks,
    '@/lib/supabase/server': { createClient: async () => database },
    '@/lib/auth/get-user': { getUser: async () => ({ profile: { role: 'owner' } }) },
    '@/lib/auth/role-access': { canViewJobBoard: () => true },
  });
  const request = { projectId: job, logId: '44444444-4444-4444-8444-444444444444', phaseId,
    evidenceUpdatedAt: stamp, phaseUpdatedAt: stamp, status: 'in_progress', endDate: null, note: 'Verified with field lead' };
  assert.equal((await review.reviewFieldProgress(request)).error, null);
  assert.equal(called.args.p_forecast_start, '2026-10-23');
  assert.equal(called.args.p_forecast_end, '2026-10-24');
  assert.equal((await review.reviewFieldProgress({ ...request, status: null, endDate: '2026-10-27' })).error, null);
  assert.equal(called.args.p_forecast_start, '2026-10-23'); // finish edit pins displayed start too
  assert.equal((await review.verifyClientPhaseCompletion({ projectId: job, phaseId, phaseUpdatedAt: stamp, clientCompletedAt: stamp, note: 'Verified completed work' })).error, null);
  assert.equal(called.args.p_forecast_start, '2026-10-23');
  assert.equal(called.args.p_client_completed_at, stamp);
  rows[1].is_manually_scheduled = true;
  assert.equal((await review.reviewFieldProgress(request)).error, null);
  assert.equal(called.args.p_forecast_start, null);
}

(async () => {
  await actionChecks();
  await portalChecks();
  await aiChecks();
  await reviewChecks();
  console.log('Schedule dates passed: explicit edits, unchanged baseline, slip from displayed dates, finish delay, parallel/overhead guards, readiness, portal parity, AI routing, errors and cache invalidation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
