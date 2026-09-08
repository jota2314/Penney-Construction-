const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const projectId = '11111111-1111-4111-8111-111111111111';
const updateId = '22222222-2222-4222-8222-222222222222';
const authorId = '33333333-3333-4333-8333-333333333333';
function setup(user, result = { data: [{ id: updateId }], error: null }) {
  const filters = {};
  const paths = [];
  let calls = 0;
  const query = { delete() { return this; }, eq(k, v) { filters[k] = v; return this; }, async select() { return result; } };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('src/lib/actions/project-updates.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, console, require(name) {
    if (name === 'zod') return require('zod');
    if (name === 'next/cache') return { revalidatePath: p => paths.push(p) };
    if (name.endsWith('get-user')) return { getUser: async () => user };
    if (name.endsWith('tagged-mentions')) return {};
    if (name.endsWith('supabase/server')) return { createClient: async () => ({ from(table) { assert.equal(table, 'project_updates'); calls++; return query; } }) };
    throw new Error(name);
  }});
  return { remove: module.exports.deleteProjectUpdate, filters, paths, calls: () => calls };
}
test('rejects invalid IDs before database access', async () => {
  const s = setup({ id: authorId });
  assert.equal((await s.remove(projectId, 'bad')).ok, false);
  assert.equal(s.calls(), 0);
});
test('requires a signed-in author', async () => {
  const s = setup(null);
  assert.equal((await s.remove(projectId, updateId)).ok, false);
  assert.equal(s.calls(), 0);
});
test('scopes deletion to the signed-in author and exact project/update', async () => {
  const s = setup({ id: authorId });
  assert.equal((await s.remove(projectId, updateId)).ok, true);
  assert.deepEqual(s.filters, { id: updateId, project_id: projectId, author_id: authorId });
  assert.deepEqual(s.paths, [`/projects/${projectId}`]);
});
test('does not report success when row is absent or belongs to someone else', async () => {
  const s = setup({ id: authorId }, { data: [], error: null });
  assert.equal((await s.remove(projectId, updateId)).ok, false);
  assert.equal(s.paths.length, 0);
});
test('reports database errors without invalidating the page', async () => {
  const s = setup({ id: authorId }, { data: null, error: { message: 'denied' } });
  assert.equal((await s.remove(projectId, updateId)).ok, false);
  assert.equal(s.paths.length, 0);
});

