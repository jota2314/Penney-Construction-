const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

function load(path, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Buffer, FormData,
    console: { warn() {} }, require: name => imports[name] ?? {}, ...globals });
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const owner = 'test-owner';
const path = owner + '/bill.pdf';
const jobs = [{ id: 'job', name: 'Test job', project_number: 'TEST', status: 'in_progress' }];
const lines = [
  { id: 'siding', description: 'Siding', trade: 'siding' },
  { id: 'concrete', description: 'Concrete', trade: 'concrete' },
];
function query(data) {
  const q = { select: () => q, eq: () => q, limit: async () => ({ data }),
    maybeSingle: async () => ({ data: data[0] }), single: async () => ({ data: data[0] }) };
  return q;
}
function harness() {
  let checkpoint = null, extractionCalls = 0, allocationCalls = 0;
  let proposed = null;
  const client = {
    from: table => query(table === 'projects' ? jobs : lines),
    rpc: async () => ({ data: 'estimate' }),
    storage: { from: () => ({ download: async () => ({ data: new Blob(['pdf'], { type: 'application/pdf' }) }) }) },
  };
  const imports = {
    'next/server': { NextResponse: { json: (body, options) => ({ body: plain(body), status: options?.status ?? 200 }) } },
    '@/lib/auth/get-user': { getUser: async () => ({ id: owner }) },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/finance/credit-detection': { detectCreditDocument: () => ({ isCredit: false }), signedAmount: n => n },
    '@/lib/finance/quote-detection': { detectQuoteDocument: () => ({ isQuote: false }) },
    '@/lib/finance/spend-category': { looksLikeFuelPurchase: () => false },
    '@/lib/bills/model': { askClaude: async (_content, tokens) => {
      if (tokens === 6000) {
        extractionCalls++;
        return { document_type: 'invoice', vendor_name: 'Supplier', amount: 1019.73,
          invoice_number: '344955', matched_project_id: 'job', confidence: 0.99,
          items: [{ description: 'Siding', amount: 600 }, { description: 'Concrete', amount: 419.73 }] };
      }
      allocationCalls++;
      return proposed;
    } },
  };
  const store = load('src/lib/bills/read-store.ts', imports);
  imports['@/lib/bills/read-store'] = {
    ...store,
    loadBillRead: async () => checkpoint && plain(checkpoint),
    saveBillRead: async (_owner, read) => { checkpoint = plain(read); return plain(checkpoint); },
  };
  return {
    imports, read: () => load('src/app/api/bills/scan/route.ts', imports),
    allocate: () => load('src/app/api/bills/allocate/route.ts', imports),
    counts: () => ({ extractionCalls, allocationCalls }), saved: () => plain(checkpoint),
    propose: value => { proposed = value; },
  };
}
const scanRequest = () => ({ formData: async () => { const body = new FormData(); body.set('storagePath', path); return body; } });
const allocationRequest = (extra = {}) => ({ json: async () => ({ storagePath: path, projectId: 'job', ...extra }) });

test('read persists before allocation; allocation failure and reopening do not re-read the PDF', async () => {
  const h = harness();
  const read = await h.read().POST(scanRequest());
  assert.equal(read.status, 200);
  assert.equal(read.body.allocationStatus, 'pending');
  assert.equal(h.saved().scan.amount, 1019.73);
  assert.deepEqual(h.counts(), { extractionCalls: 1, allocationCalls: 0 });
  const failed = await h.allocate().POST(allocationRequest());
  assert.equal(failed.body.allocationStatus, 'failed');
  assert.equal(failed.body.budgetLines.length, 2);
  assert.equal(h.saved().scan.items.length, 2);
  // Fresh server module / new browser request: checkpoint survives.
  await h.read().POST(scanRequest());
  assert.equal(h.counts().extractionCalls, 1);
  h.propose({ allocations: [{ line_item_id: 'siding', amount: 600 }, { line_item_id: 'concrete', amount: 419.73 }] });
  const retried = await h.allocate().POST(allocationRequest());
  assert.equal(retried.body.allocationStatus, 'complete');
  assert.equal(retried.body.allocations.length, 2);
  assert.equal(retried.body.allocations.reduce((sum, a) => sum + Math.round(a.amount * 100), 0), 101973);
  assert.equal(h.counts().extractionCalls, 1);
});

test('wrong-user paths and unauthenticated requests cannot read or allocate checkpoints', async () => {
  const h = harness();
  const denied = await h.allocate().POST(allocationRequest({ storagePath: 'someone-else/bill.pdf' }));
  assert.equal(denied.status, 403);
  h.imports['@/lib/auth/get-user'].getUser = async () => null;
  assert.equal((await h.read().POST(scanRequest())).status, 401);
  assert.equal((await h.allocate().POST(allocationRequest())).status, 401);
  assert.deepEqual(h.counts(), { extractionCalls: 0, allocationCalls: 0 });
});

test('missing, foreign or unbalanced allocations are rejected without inventing a budget split', async () => {
  const h = harness(); await h.read().POST(scanRequest());
  for (const allocations of [
    [{ line_item_id: 'siding', amount: 100 }],
    [{ line_item_id: 'foreign-job-line', amount: 1019.73 }],
    [{ line_item_id: 'siding', amount: 1019.73 }, { line_item_id: 'concrete', amount: -20 }],
  ]) {
    h.propose({ allocations });
    const response = await h.allocate().POST(allocationRequest());
    assert.equal(response.body.allocationStatus, 'failed');
    assert.deepEqual(response.body.allocations, []);
  }
});

test('corrected total affects allocation but does not overwrite the saved original read', async () => {
  const h = harness(); await h.read().POST(scanRequest());
  h.propose({ allocations: [{ line_item_id: 'siding', amount: 500 }, { line_item_id: 'concrete', amount: 500 }] });
  const response = await h.allocate().POST(allocationRequest({ amount: 1000 }));
  assert.equal(response.body.scan.amount, 1000);
  assert.equal(response.body.allocationStatus, 'complete');
  assert.equal(h.saved().scan.amount, 1019.73);
});

test('browser keeps the read after a lost allocation response; retry calls allocation only', async () => {
  const h = harness(); const read = (await h.read().POST(scanRequest())).body;
  const calls = [], events = [];
  const client = load('src/lib/bills/scan-client.ts', {}, { fetch: async (url) => {
    calls.push(url);
    if (url === '/api/bills/scan') return { ok: true, json: async () => read };
    assert.equal(events[0], 'read-visible');
    throw new Error('connection lost');
  } });
  const result = await client.scanBill(new FormData(), () => events.push('read-visible'));
  assert.equal(result.scan.amount, 1019.73);
  assert.equal(result.allocationStatus, 'failed');
  await client.allocateBill(result);
  assert.deepEqual(calls, ['/api/bills/scan', '/api/bills/allocate', '/api/bills/allocate']);
});
