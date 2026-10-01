import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const source = ts.transpileModule(fs.readFileSync(new URL('../src/app/api/warehouse/assistant/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function endpoint({ access = true, failure = false, fabricated = false } = {}) {
  const calls = { loads: 0, model: 0 };
  const module = { exports: {} };
  const snapshot = { capturedAt: '2026-09-30T12:00:00Z', activitySince: '2026-08-31T12:00:00Z', items: [{ id: 'real', name: 'Real material', sku: 'WH-0001', unit: 'box', quantity_on_hand: 3, location: 'Rack 1' }], orders: [], transactions: [], checkouts: [], warnings: [] };
  vm.runInNewContext(source, { module, exports: module.exports, console: { error() {} }, Date, Map, require(name) {
    if (name.endsWith('intelligence-server')) return {
      warehouseIntelligenceAccess: async () => access ? { id: 'user' } : null,
      loadWarehouseSnapshot: async () => { calls.loads++; if (failure) throw Error('DB failed'); return snapshot; },
    };
    if (name.endsWith('/intelligence')) return { buildWarehouseInsights: () => ({ stock: [], people: [] }) };
    if (name.endsWith('/claude')) return { CLAUDE_SONNET_4_6: 'test-model', logAiUsage: async () => {}, getAnthropicClient: async () => ({ messages: { create: async () => {
      calls.model++;
      return { model: 'test-model', usage: { input_tokens: 10, output_tokens: 20 }, content: [{ type: 'tool_use', name: 'warehouse_answer', input: { answer: 'Verify the material label.', materials: [{ itemId: fabricated ? 'invented' : 'real', reason: 'A possible match', verify: 'Confirm size' }], questions: [] } }] };
    } } }) };
    return require(name);
  } });
  return { post: module.exports.POST, calls };
}
const request = (body) => new Request('http://localhost/api/warehouse/assistant', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
test('unauthorized calls never read warehouse records or invoke the model', async () => {
  const { post, calls } = endpoint({ access: false });
  assert.equal((await post(request({ question: 'roofing' }))).status, 403);
  assert.equal(calls.loads, 0); assert.equal(calls.model, 0);
});
test('malformed and oversized questions fail before a data/model call', async () => {
  for (const body of ['invalid', { question: 'x' }, { question: 'x'.repeat(1600) }, 'x'.repeat(9000)]) {
    const { post, calls } = endpoint();
    assert.equal((await post(request(body))).status, 400);
    assert.equal(calls.loads, 0); assert.equal(calls.model, 0);
  }
});
test('a source failure cannot produce an empty-inventory AI answer', async () => {
  const { post, calls } = endpoint({ failure: true });
  assert.equal((await post(request({ question: 'What is in stock?' }))).status, 503);
  assert.equal(calls.model, 0);
});
test('fabricated material references are rejected', async () => {
  const { post } = endpoint({ fabricated: true });
  assert.equal((await post(request({ question: 'What is in stock?' }))).status, 503);
});
test('evidence card quantities and locations come from the fresh database snapshot', async () => {
  const { post } = endpoint();
  const response = await post(request({ question: 'What is in stock?' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.materials[0].quantity, 3);
  assert.equal(body.materials[0].location, 'Rack 1');
  assert.equal(body.materials[0].sku, 'WH-0001');
});
