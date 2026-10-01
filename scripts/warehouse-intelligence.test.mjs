import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/warehouse/intelligence.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildWarehouseInsights, shopDay, matchesMaterial } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const item = { id: 'i', name: 'Roofing nailer', unit: 'each', quantity_on_hand: 5, reorder_point: 0, reorder_quantity: null, description: 'Pneumatic coil roofing tool', sku: 'WH-0001', notes: 'Model unconfirmed' };
const snapshot = (changes = {}) => ({ items: [item], orders: [], checkouts: [], transactions: [], capturedAt: '2026-10-01T01:00:00Z', warnings: [], ...changes });
const order = (status, quantity, changes = {}) => ({ id: status, order_number: status, status, priority: 'normal', needed_by: null, material_order_items: [{ item_id: 'i', quantity, quantity_fulfilled: 0, unit: 'each', ...changes }] });

test('approved demand accounts for partial picks; pending and ready do not subtract twice', () => {
  const r = buildWarehouseInsights(snapshot({ orders: [order('approved', 7, { quantity_fulfilled: 3 }), order('pending', 50), order('ready', 8, { quantity_fulfilled: 8 })] }));
  assert.equal(r.stock[0].approvedDemand, 4);
  assert.equal(r.stock[0].availableAfterDemand, 1);
  assert.equal(r.stock[0].shortage, 0);
});
test('a partially fulfilled ready order retains its unpicked demand and gets a follow-up', () => {
  const r = buildWarehouseInsights(snapshot({ orders: [order('ready', 9, { quantity_fulfilled: 3 })] }));
  assert.equal(r.stock[0].approvedDemand, 6);
  assert.equal(r.stock[0].shortage, 1);
  assert.ok(r.actions.some(a => a.title.includes('Resolve incomplete pick')));
});
test('multiple approved orders aggregate demand; checkout is not subtracted again', () => {
  const r = buildWarehouseInsights(snapshot({ orders: [order('approved', 4), order('approved', 3)], checkouts: [{ item_id: 'i', quantity_outstanding: 2, checked_out_at: '2026-09-30T12:00:00Z' }] }));
  assert.equal(r.stock[0].shortage, 2);
  assert.equal(r.stock[0].out, 2);
  assert.equal(r.stock[0].suggestedQuantity, 2);
});
test('mismatched units and write-in lines require verification, not arithmetic', () => {
  const r = buildWarehouseInsights(snapshot({ orders: [order('approved', 4, { unit: 'box' }), order('pending', 3, { item_id: null })] }));
  assert.equal(r.stock[0].approvedDemand, 0);
  assert.ok(r.actions.some(a => a.detail.includes('catalog/unit verification')));
});
test('zero stock with default reorder point never invents a purchase quantity', () => {
  const r = buildWarehouseInsights(snapshot({ items: [{ ...item, quantity_on_hand: 0 }] }));
  assert.equal(r.stock[0].suggestedQuantity, 0);
  assert.match(r.actions[0].detail, /no replenishment target/);
});
test('configured reorder quantity is a floor and restores threshold after demand', () => {
  const r = buildWarehouseInsights(snapshot({ items: [{ ...item, quantity_on_hand: 3, reorder_point: 5, reorder_quantity: 10 }], orders: [order('approved', 8)] }));
  assert.equal(r.stock[0].suggestedQuantity, 10);
});
test('due dates and aging use shop calendar day, not UTC date', () => {
  assert.equal(shopDay('2026-10-01T01:00:00Z'), '2026-09-30');
  const r = buildWarehouseInsights(snapshot({ orders: [{ ...order('approved', 1), needed_by: '2026-09-30' }], checkouts: [{ item_id: 'i', checked_out_at: '2026-09-16T01:00:00Z', quantity_outstanding: 1 }] }));
  assert.equal(r.actions.find(a => a.id === 'order:approved').priority, 'review');
  assert.ok(r.actions.some(a => a.title.includes('out 15 days')));
});
test('logger identities group by ID and never guess unlinked aliases or holders', () => {
  const r = buildWarehouseInsights(snapshot({ transactions: [
    { performed_by: 'p', performed_by_name: 'Richard', employee_name: 'Steven', created_at: '2026-09-30T10:00:00Z' },
    { performed_by: 'p', performed_by_name: 'Rick', created_at: '2026-09-29T10:00:00Z' },
    { performed_by: null, performed_by_name: 'Rick', created_at: '2026-09-28T10:00:00Z' },
  ] }));
  assert.equal(r.people.length, 2);
  assert.equal(r.people[0].movements, 2);
  assert.ok(!r.people.some(p => p.name === 'Steven'));
});
test('search matches multiword specifications and notes regardless of word order', () => {
  assert.ok(matchesMaterial(item, 'coil pneumatic'));
  assert.ok(matchesMaterial(item, 'unconfirmed'));
  assert.ok(!matchesMaterial(item, 'hydraulic'));
});
