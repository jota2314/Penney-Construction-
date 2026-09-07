const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

function load(path, imports, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports,
    require: name => imports[name], File, FormData, Error, ...globals });
  return module.exports;
}
function clientHarness({ storeError, finishError, lostFinish } = {}) {
  const calls = [];
  const helper = load('src/lib/receipts/save-upload.ts', {
    '@/lib/supabase/client': { createClient: () => ({ storage: { from: () => ({
      uploadToSignedUrl: async (path, token, file) => {
        calls.push(['stored', file]); return { error: storeError };
      },
    }) } }) },
  }, { fetch: async (_url, options) => {
    const input = JSON.parse(options.body); calls.push([input.action, input]);
    if (input.action === 'finish' && lostFinish) throw new Error('Disconnected');
    return { ok: !finishError || input.action === 'prepare', json: async () =>
      input.action === 'prepare' ? { path: 'owner/receipt.pdf', token: 'test' } :
      { saved: true, error: finishError } };
  } });
  const body = new FormData();
  body.set('file', new File([new Uint8Array(6 * 1024 * 1024)], 'receipt.pdf', { type: 'application/pdf' }));
  return { ...helper, body, calls };
}
test('large file is saved and attachment verified before the AI input is returned', async () => {
  const h = clientHarness();
  await h.saveReceiptUpload(h.body, 'invoice-id');
  assert.deepEqual(h.calls.map(c => c[0]), ['prepare', 'stored', 'finish']);
  assert.equal(h.calls[1][1].size, 6 * 1024 * 1024);
  assert.equal(h.calls[2][1].invoiceId, 'invoice-id');
  assert.equal(h.body.has('file'), false);
  assert.equal(h.body.get('storagePath'), 'owner/receipt.pdf');
  assert.match(h.savedUploadError(h.body, 'AI failed'), /file is saved/);
});
test('failed storage upload cannot claim the file was saved', async () => {
  const h = clientHarness({ storeError: { message: 'offline' } });
  await assert.rejects(h.saveReceiptUpload(h.body), /not confirmed/);
  assert.equal(h.body.has('storagePath'), false);
  assert.equal(h.calls.some(c => c[0] === 'finish'), false);
});
test('attachment failure retains recoverable file without continuing to scan', async () => {
  const h = clientHarness({ finishError: 'Could not attach' });
  await assert.rejects(h.saveReceiptUpload(h.body, 'invoice-id'), /Could not attach/);
  assert.equal(h.body.get('storagePath'), 'owner/receipt.pdf');
});
test('lost final response retains path; a re-scan does not upload a second copy', async () => {
  const h = clientHarness({ lostFinish: true });
  await assert.rejects(h.saveReceiptUpload(h.body), /Disconnected/);
  const count = h.calls.length;
  assert.equal(await h.saveReceiptUpload(h.body), 'owner/receipt.pdf');
  assert.equal(h.calls.length, count);
});

function serverHarness({ infoError, bindError, signedIn = true } = {}) {
  const calls = [];
  const route = load('src/app/api/receipts/upload/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/auth/get-user': { getUser: async () => signedIn ? { id: 'owner' } : null },
    '@/lib/supabase/server': { createClient: async () => ({ storage: { from: () => ({
      info: async () => { calls.push('verify'); return { data: infoError ? null : {}, error: infoError }; },
    }) } }) },
    '@/lib/actions/field-capture': { attachReceiptToCapture: async () => { calls.push('attach'); return { error: bindError }; } },
  });
  return { calls, post: input => route.POST({ json: async () => input }) };
}
test('server verifies stored file before attaching it to an existing invoice', async () => {
  const h = serverHarness();
  assert.equal((await h.post({ action: 'finish', path: 'owner/file', invoiceId: 'id' })).status, 200);
  assert.deepEqual(h.calls, ['verify', 'attach']);
});
test('missing file and unauthorized path never attach', async () => {
  const h = serverHarness({ infoError: 'missing' });
  assert.equal((await h.post({ action: 'finish', path: 'other/file', invoiceId: 'id' })).status, 400);
  assert.equal((await h.post({ action: 'finish', path: 'owner/file', invoiceId: 'id' })).status, 500);
  assert.equal(h.calls.includes('attach'), false);
  assert.equal((await serverHarness({ signedIn: false }).post({})).status, 401);
});
test('binding error reports saved file but not successful attachment', async () => {
  const h = serverHarness({ bindError: 'No transaction' });
  const result = await h.post({ action: 'finish', path: 'owner/file', invoiceId: 'id' });
  assert.equal(result.status, 409);
  assert.equal(result.body.saved, true);
});
