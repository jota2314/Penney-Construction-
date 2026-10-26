/* eslint-disable @typescript-eslint/no-require-imports */
// Exercise the real protected image route without login or production writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
// Synthetic bytes only: the real company card must never enter this repository.
const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x02, 0x03, 0xff, 0xd9]);
const source = fs.readFileSync(path.join(root, 'src/app/api/crew/gas-card/route.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function routeFor(user, storageResult = { data: new Blob([imageBytes]), error: null }) {
  let adminClients = 0;
  let imageReads = 0;
  const context = {
    exports: {}, Response,
    require(name) {
      if (name === '@/lib/auth/get-user') return { getUser: async () => user };
      if (name === '@/lib/supabase/admin') return {
        createAdminClient() {
          adminClients++;
          return { storage: { from(bucket) {
            assert.equal(bucket, 'crew-resources');
            return { async download(objectPath) {
              imageReads++;
              assert.equal(objectPath, 'bjs-gas-card.jpg');
              return storageResult;
            } };
          } } };
        },
      };
      return require(name);
    },
  };
  vm.runInNewContext(compiled, context, { filename: 'gas-card/route.ts' });
  return { GET: context.exports.GET, imageReads: () => imageReads, adminClients: () => adminClients };
}

function privateResponse(response) {
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
}

test('guests, missing profiles and non-crew roles cannot read the card', async () => {
  for (const [user, status] of [
    [null, 401],
    [{ id: 'user', profile: null }, 403],
    [{ id: 'user', profile: { role: null } }, 403],
    ...['owner', 'office_admin', 'precon_manager', 'project_manager', 'client', 'subcontractor'].map(role => [
      { id: 'user', profile: { role } }, 403,
    ]),
  ]) {
    const route = routeFor(user);
    const response = await route.GET();
    assert.equal(response.status, status);
    assert.equal(route.adminClients(), 0, 'Denied requests must not create a privileged storage client');
    assert.equal(route.imageReads(), 0, 'Denied requests must not read the private asset');
    assert.notEqual(response.headers.get('Content-Type'), 'image/jpeg');
    privateResponse(response);
  }
});

test('field crew and authorized View As receive unchanged storage bytes privately', async () => {
  for (const user of [
    { id: 'crew', profile: { role: 'field' } },
    { id: 'owner', profile: { role: 'field' }, realProfile: { role: 'owner' }, isImpersonating: true },
  ]) {
    const route = routeFor(user);
    const response = await route.GET();
    assert.equal(response.status, 200);
    assert.equal(route.adminClients(), 1);
    assert.equal(route.imageReads(), 1);
    assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
    privateResponse(response);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, imageBytes, 'Response must retain every storage byte');
  }
});

test('storage failures and missing objects return a private unavailable response', async () => {
  for (const storageResult of [
    { data: null, error: { message: 'missing object' } },
    { data: null, error: null },
    { data: new Blob([imageBytes]), error: { message: 'storage failure' } },
  ]) {
    const route = routeFor({ id: 'crew', profile: { role: 'field' } }, storageResult);
    const response = await route.GET();
    assert.equal(response.status, 503);
    assert.equal(route.imageReads(), 1);
    assert.notEqual(response.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(await response.text(), 'The gas card is temporarily unavailable.');
    privateResponse(response);
  }
});
