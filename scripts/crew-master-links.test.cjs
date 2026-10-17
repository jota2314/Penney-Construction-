/* eslint-disable @typescript-eslint/no-require-imports */
// Exercise actual crew actions with an in-memory Supabase boundary. No network writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const clone = value => structuredClone(value);

function load(file, mocks) {
  const context = { exports: {}, Date, console, require(name) {
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/')) return load(path.resolve('src', name.slice(2)) + '.ts', mocks);
    return require(name);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context, { filename: file });
  return context.exports;
}

function fixture() {
  const job = randomUUID(), otherJob = randomUUID(), person = randomUUID(), owner = randomUUID();
  const tables = { projects: [{ id: job, name: 'Kitchen' }, { id: otherJob, name: 'Bath' }], schedule_phases: [], estimate_line_items: [] };
  const writes = [];
  let role = 'owner';
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.mode = 'select'; }
    select() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    lte(key, value) { this.filters.push(row => row[key] <= value); return this; }
    gte(key, value) { this.filters.push(row => row[key] >= value); return this; }
    contains(key, values) { this.filters.push(row => values.every(value => row[key]?.includes(value))); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    or(expression) { const parts = expression.split(',').map(part => part.split('.')); this.filters.push(row => parts.some(([key, op, value]) => op === 'eq' && row[key] === value)); return this; }
    order() { return this; }
    update(value) { this.mode = 'update'; this.value = value; return this; }
    insert(value) { this.mode = 'insert'; this.value = value; return this; }
    delete() { this.mode = 'delete'; return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    then(resolve, reject) {
      try {
        let selected = tables[this.table].filter(row => this.filters.every(filter => filter(row)));
        if (this.mode !== 'select') writes.push({ table: this.table, mode: this.mode });
        if (this.mode === 'insert') {
          selected = (Array.isArray(this.value) ? this.value : [this.value]).map(row => ({ id: randomUUID(), ...clone(row) }));
          tables[this.table].push(...selected);
        } else if (this.mode === 'update') for (const row of selected) Object.assign(row, clone(this.value));
        else if (this.mode === 'delete') tables[this.table] = tables[this.table].filter(row => !selected.includes(row));
        return Promise.resolve({ data: clone(this.one ? selected[0] ?? null : selected), error: null }).then(resolve, reject);
      } catch (error) { return Promise.reject(error).then(resolve, reject); }
    }
  }
  const mocks = {
    'next/cache': { revalidatePath() {} },
    '@/lib/schedule/revalidate': { revalidateSchedule() {} },
    '@/lib/supabase/server': { createClient: async () => ({ from: table => new Query(table) }) },
    '@/lib/auth/get-user': { getUser: async () => ({ id: owner, email: 'fixture@example.test', profile: { id: owner, role, full_name: 'Office' } }) },
    '@/lib/auth/role-access': { canViewJobBoard: viewer => viewer.role === 'owner' },
    '@/lib/board/crew-colors': { projectColor: () => '#123456' },
    '@/lib/board/board-data': { easternToday: () => '2026-10-16' },
  };
  const action = load(path.resolve('src/lib/actions/crew-board.ts'), mocks);
  const phase = (overrides = {}) => {
    const row = { id: randomUUID(), project_id: job, name: 'Framing', phase_scope: 'master', event_type: 'phase',
      start_date: '2026-10-19', end_date: '2026-10-21', status: 'not_started', sort_order: 0, color: null,
      is_confirmed: true, confirmed_at: null, confirmed_with: null, assigned_employee_ids: [], assigned_sub_ids: [],
      notes: null, estimate_line_item_id: null, master_phase_id: null, ...overrides };
    tables.schedule_phases.push(row); return row;
  };
  const master = phase(), second = phase({ name: 'Trim' });
  const crew = (overrides = {}) => phase({ phase_scope: 'daily', event_type: 'crew', assigned_employee_ids: [person], master_phase_id: master.id, ...overrides });
  const input = { personKind: 'employee', personId: person, date: '2026-10-20', projectId: job, scope: 'Framing', confirmed: true };
  return { action, phase, crew, master, second, input, tables, writes, job, otherJob, person, setRole: value => { role = value; }, rows: () => tables.schedule_phases.filter(row => row.event_type === 'crew') };
}

test('dispatch may be unlinked or explicitly linked without changing master progress', async () => {
  const f = fixture();
  assert.equal((await f.action.setCrewAssignment(f.input)).error, null);
  assert.equal(f.rows()[0].master_phase_id, null);
  assert.equal((await f.action.assignCrewCells({ cells: [{ ...f.input, date: '2026-10-21' }], projectId: f.job, scope: 'Framing', confirmed: true, masterPhaseId: f.master.id })).error, null);
  assert.equal(f.rows().find(row => row.start_date === '2026-10-21').master_phase_id, f.master.id);
  assert.equal(f.master.status, 'not_started');
});

test('editing without a link keeps it; explicit null clears; explicit ID replaces', async () => {
  const f = fixture(); f.crew({ start_date: f.input.date, end_date: f.input.date });
  for (const [patch, expected] of [[{}, f.master.id], [{ masterPhaseId: null }, null], [{ masterPhaseId: f.second.id }, f.second.id]]) {
    const result = await f.action.setCrewAssignment({ ...f.input, replacePhaseId: f.rows()[0].id, ...patch });
    assert.equal(result.error, null); assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].master_phase_id, expected);
  }
});

test('wrong-job and daily-row links fail before removing or splitting existing assignments', async () => {
  const f = fixture(), old = f.crew(), wrong = f.phase({ project_id: f.otherJob });
  for (const id of [wrong.id, old.id, randomUUID()]) {
    assert.match((await f.action.setCrewAssignment({ ...f.input, replacePhaseId: old.id, masterPhaseId: id })).error, /master schedule task/);
    assert.match((await f.action.assignCrewCells({ cells: [f.input], projectId: f.job, confirmed: true, masterPhaseId: id })).error, /master schedule task/);
  }
  assert.equal(f.writes.length, 0); assert.equal(f.rows()[0].end_date, '2026-10-21');
});

test('block fill merges only equal master links and splitting preserves the surrounding work', async () => {
  const f = fixture();
  await f.action.assignCrewCells({ cells: ['19', '20', '21'].map(day => ({ ...f.input, date: `2026-10-${day}` })), projectId: f.job, scope: 'Framing', confirmed: true, masterPhaseId: f.master.id });
  assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].end_date, '2026-10-21');
  await f.action.setCrewAssignment({ ...f.input, masterPhaseId: f.second.id });
  assert.equal(f.rows().length, 3);
  for (const row of f.rows()) assert.equal(row.master_phase_id, row.start_date === f.input.date ? f.second.id : f.master.id);
  await f.action.setCrewAssignment({ ...f.input, masterPhaseId: f.master.id });
  assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].master_phase_id, f.master.id);
});

test('move, copy and shared-run split keep their explicit link', async () => {
  const f = fixture(), old = f.crew();
  await f.action.moveCrewAssignment({ phaseId: old.id, fromKind: 'employee', fromId: f.person, fromDate: f.input.date, toKind: 'employee', toId: f.person, toDate: '2026-10-23' });
  assert.equal(f.rows().length, 3); assert.ok(f.rows().every(row => row.master_phase_id === f.master.id));
  const source = f.rows().find(row => row.start_date === '2026-10-23');
  await f.action.moveCrewAssignment({ phaseId: source.id, fromKind: 'employee', fromId: f.person, fromDate: '2026-10-23', toKind: 'employee', toId: f.person, toDate: '2026-10-26', copy: true });
  assert.ok(f.rows().some(row => row.id === source.id)); assert.ok(f.rows().every(row => row.master_phase_id === f.master.id));
  const shared = f.crew({ assigned_employee_ids: [f.person, randomUUID()], start_date: '2026-10-27', end_date: '2026-10-29' });
  await f.action.clearCrewAssignment({ ...f.input, date: '2026-10-28', phaseId: shared.id });
  assert.ok(f.rows().every(row => row.master_phase_id === f.master.id));
  assert.ok(f.rows().some(row => row.start_date === '2026-10-29' && row.assigned_employee_ids.length === 1));
});

test('options are authorized and scoped to real master work in the selected job', async () => {
  const f = fixture(); f.crew(); f.phase({ project_id: f.otherJob }); f.phase({ event_type: 'clock_in' });
  const legacy = f.phase({ phase_scope: null, name: 'Legacy task' });
  const result = await f.action.getProjectMasterPhaseOptions(f.job);
  assert.equal(result.error, null); assert.deepEqual(Array.from(result.options, row => row.id).sort(), [f.master.id, f.second.id, legacy.id].sort());
  f.setRole('field'); assert.equal((await f.action.getProjectMasterPhaseOptions(f.job)).error, 'Not allowed');
  assert.equal((await f.action.setCrewAssignment(f.input)).error, 'Not allowed'); assert.equal(f.writes.length, 0);
});

test('clipboard retains the parent identity and selector offers optional deferred linking', () => {
  const { clipFrom } = load(path.resolve('src/components/board/crew-helpers.ts'), {});
  assert.equal(clipFrom({ projectId: 'job', masterPhaseId: 'master', name: 'Framing', projectName: 'Kitchen' }).masterPhaseId, 'master');
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { CrewMasterPhasePicker } = load(path.resolve('src/components/board/crew-master-phase-picker.tsx'), { '@/lib/actions/crew-board': {} });
  const html = renderToStaticMarkup(React.createElement(CrewMasterPhasePicker, { projectId: 'job', value: 'master', onChange() {} }));
  assert.match(html, /Master schedule task \(optional\)/); assert.match(html, /Link later in Schedule review/); assert.match(html, /Current linked task/);
});
