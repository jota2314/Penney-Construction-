/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let user, log, uploads, appends, uploadError, appendError;
const logId = '00000000-0000-4000-8000-000000000001';
const uploadId = '00000000-0000-4000-8000-000000000002';
const path = `${logId}/${uploadId}.jpg`;
const storage = {
  upload: async (key) => { uploads.push(key); return {error: uploadError}; },
  list: async () => ({data: [{name: `${uploadId}.jpg`}]}),
};
const context = {exports: {}, Blob, crypto, require: name => {
  if (name === 'zod') return require(name);
  if (name === 'next/server') return {NextResponse: {json: (body, options) => ({body, status: options?.status ?? 200})}};
  if (name.endsWith('/get-user')) return {getUser: async () => user};
  if (name.endsWith('/server')) return {createClient: async () => ({from: () => ({
    select() {return this;}, eq() {return this;}, maybeSingle: async () => ({data: log}),
  })})};
  if (name.endsWith('/admin')) return {createAdminClient: () => ({
    storage: {from: () => storage}, rpc: async (name, args) => {
      assert.equal(name, 'append_daily_log_photo'); appends.push(args);
      return {data: !appendError, error: appendError};
    },
  })};
  throw new Error(name);
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/crew/daily-log-photo/route.ts', 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText, context);
function reset() {
  user = {profile: {id: 'worker', role: 'field'}};
  log = {id: logId, author_id: 'other-worker', status: 'completed'};
  uploads = []; appends = []; uploadError = null; appendError = null;
}
function request(overrides = {}) {
  const entries = {logId, uploadId, file: new Blob(['image'], {type: 'image/jpeg'}), ...overrides};
  return {formData: async () => ({get: key => entries[key] ?? null})};
}
(async () => {
  for (const role of ['field', 'owner', 'precon_manager', 'project_manager', 'office_admin']) {
    reset(); user.profile.role = role;
    assert.equal((await context.exports.POST(request())).status, 200, role);
    assert.deepEqual(uploads, [path]);
    assert.equal(appends[0].p_log_id, logId); assert.equal(appends[0].p_path, path);
  }
  for (const denied of [null, {profile: null}, {profile: {role: 'external'}}]) {
    reset(); user = denied;
    assert.equal((await context.exports.POST(request())).status, 401);
    assert.equal(uploads.length, 0);
  }
  reset(); log = null;
  assert.equal((await context.exports.POST(request())).status, 404); assert.equal(uploads.length, 0);
  reset(); log.status = 'in_progress';
  assert.equal((await context.exports.POST(request())).status, 403); assert.equal(uploads.length, 0);
  log.author_id = 'worker';
  assert.equal((await context.exports.POST(request())).status, 200);
  reset(); assert.equal((await context.exports.POST(request({logId: '../other'}))).status, 400);
  assert.equal(uploads.length, 0);
  reset(); uploadError = {message: 'Already exists'};
  assert.equal((await context.exports.POST(request())).status, 200);
  assert.equal(appends[0].p_path, path);
  reset(); appendError = {message: 'Temporary failure'};
  assert.equal((await context.exports.POST(request())).status, 500);
  console.log('PASS: every team role can append photos to a completed teammate log; unauthenticated/missing-profile/external/unreadable/active-other logs blocked; own active upload and stable retry path preserved.');
})().catch(error => {console.error(error); process.exitCode = 1;});
