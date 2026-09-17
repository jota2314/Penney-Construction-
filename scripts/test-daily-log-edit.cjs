/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
let user, readable, saved, writes, filters, paths;
const id = '00000000-0000-4000-8000-000000000001';
const builder = (admin) => ({
  select() { return this; },
  eq(key, value) { if (admin) filters.push([key, value]); return this; },
  is(key, value) { if (admin) filters.push([key, value]); return this; },
  update(value) { writes.push(value); return this; },
  async maybeSingle() { return admin ? saved : readable; },
});
const context = { exports: {}, console, require: name => {
  if (name === 'zod') return require(name);
  if (name === '@/lib/auth/get-user') return { getUser: async () => user };
  if (name === '@/lib/supabase/server') return { createClient: async () => ({ from: () => builder(false) }) };
  if (name === '@/lib/supabase/admin') return { createAdminClient: () => ({ from: () => builder(true) }) };
  if (name === 'next/cache') return { revalidatePath: path => paths.push(path) };
  if (name.includes('report-progress')) return { reportProgressSchema: require('zod').z.object({}) };
  return {};
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/actions/daily-logs.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const edit = context.exports.editDailyLog;
function reset() {
  user = { profile: { id: 'different-author', role: 'field' } };
  readable = { data: { id, project_id: 'job', status: 'completed' } };
  saved = { data: { id }, error: null };
  writes = []; filters = []; paths = [];
}
const input = { logId: id, text: ' Updated details ', originalText: 'Old details' };
(async () => {
  for (const role of ['field', 'owner', 'precon_manager', 'project_manager', 'office_admin']) {
    reset(); user.profile.role = role;
    assert.equal((await edit(input)).ok, true, role);
    assert.equal(JSON.stringify(writes), JSON.stringify([{text: 'Updated details'}]));
    assert.ok(filters.some(([key, value]) => key === 'text' && value === 'Old details'));
    assert.ok(paths.includes('/crew') && paths.includes('/projects/job'));
  }
  for (const denied of [null, {profile: null}, {profile: {role: 'subcontractor'}}]) {
    reset(); user = denied;
    assert.equal((await edit(input)).ok, false); assert.equal(writes.length, 0);
  }
  reset(); readable = {data: null};
  assert.equal((await edit(input)).ok, false); assert.equal(writes.length, 0);
  reset(); readable.data.status = 'in_progress';
  assert.equal((await edit(input)).ok, false); assert.equal(writes.length, 0);
  reset(); saved = {data: null, error: null};
  assert.match((await edit(input)).error, /changed/);
  reset(); saved = {data: null, error: {message: 'offline'}};
  assert.match((await edit(input)).error, /Could not save/);
  reset(); assert.equal((await edit({...input, text: '  '})).ok, false);
  assert.equal((await edit({...input, logId: 'bad'})).ok, false);
  assert.equal(writes.length, 0);
  reset(); assert.equal((await edit({...input, originalText: null})).ok, true);
  assert.ok(filters.some(([key, value]) => key === 'text' && value === null));

  const ui = { exports: {}, require: name => {
    if (name === 'next/navigation') return {useRouter: () => ({refresh() {}})};
    if (name.includes('ui/dialog')) return new Proxy({}, {get: () => () => null});
    if (name.includes('ui/button')) return {Button: 'button'};
    if (name === './tokens') return {v: () => '#111'};
    if (name.startsWith('@/')) return {};
    return require(name);
  }};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/field-feed/daily-log-edit-button.tsx', 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
  }).outputText, ui);
  const html = renderToStaticMarkup(React.createElement(ui.exports.DailyLogEditButton, {logId: id, text: 'Old', onSaved() {}}));
  assert.match(html, /aria-label="Edit daily log"/);
  assert.match(html, /> Edit<\/button>/);
  console.log('PASS: all team roles edit; unauthorized users, active shifts, stale edits and save failures handled; only text changes; Edit button renders.');
})().catch(error => { console.error(error); process.exitCode = 1; });
