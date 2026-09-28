import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

async function load(rel) {
  const source = ts.transpileModule(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const w = await load('../src/lib/warehouse/checkouts.ts');
const { canManageWarehouse } = await load('../src/lib/auth/role-access.ts');

test('days out counts shop calendar days, not UTC hours', () => {
  // 9:30 PM Sept 20 in Boston is already Sept 21 in UTC — still one calendar day out on the 21st.
  const out = '2026-09-21T01:30:00Z';
  assert.equal(w.daysOut(out, new Date('2026-09-21T13:00:00Z')), 1);
  assert.equal(w.daysOut(out, new Date('2026-09-21T02:00:00Z')), 0);
  assert.equal(w.daysOut('2026-09-14T14:00:00Z', new Date('2026-09-28T14:00:00Z')), 14);
  assert.equal(w.daysOut('2026-10-01T14:00:00Z', new Date('2026-09-28T14:00:00Z')), 0);
});

test('overdue means out MORE than the threshold', () => {
  const now = new Date('2026-09-28T15:00:00Z');
  assert.equal(w.isOverdue('2026-09-14T15:00:00Z', 14, now), false);
  assert.equal(w.isOverdue('2026-09-13T15:00:00Z', 14, now), true);
});

test('quantity and day labels', () => {
  assert.equal(w.formatQty(3), '3');
  assert.equal(w.formatQty(2.5), '2.5');
  assert.equal(w.formatQty(1.3333), '1.33');
  assert.equal(w.daysOutLabel(0), 'Today');
  assert.equal(w.daysOutLabel(1), '1 day');
  assert.equal(w.daysOutLabel(9), '9 days');
});

test('scan codes match barcode first, then SKU, then a bare shelf number', () => {
  const items = [
    { id: 'a', sku: 'WH-0012', barcode: null },
    { id: 'b', sku: 'WH-0100', barcode: '0123456789012' },
    { id: 'c', sku: 'WH-0200', barcode: 'WH-0012' },
  ];
  assert.equal(w.matchScanCode(items, ' 0123456789012 ')?.id, 'b');
  assert.equal(w.matchScanCode(items, 'WH-0012')?.id, 'c', 'a barcode beats a SKU');
  assert.equal(w.matchScanCode(items, 'wh-0100')?.id, 'b');
  assert.equal(w.matchScanCode(items, '100')?.id, 'b');
  assert.equal(w.matchScanCode(items, '999'), null);
  assert.equal(w.matchScanCode(items, ''), null);
});

test('facets group by job and person, with unlinked names kept apart', () => {
  const rows = [
    { project_id: 'p1', project_name: 'Ouellette', employee_id: 'e1', employee_name: 'Wayne' },
    { project_id: 'p1', project_name: 'Ouellette', employee_id: 'e2', employee_name: 'Angel' },
    { project_id: 'p2', project_name: 'Dougherty', employee_id: 'e1', employee_name: 'Wayne' },
    { project_id: null, project_name: null, employee_id: null, employee_name: 'Old Hand' },
  ];
  const f = w.checkoutFacets(rows);
  assert.deepEqual(f.jobs.map((j) => [j.label, j.count]), [['Dougherty', 1], ['No job', 1], ['Ouellette', 2]]);
  assert.deepEqual(f.people.map((p) => [p.label, p.count]), [['Angel', 1], ['Old Hand', 1], ['Wayne', 2]]);
  assert.equal(w.checkoutPersonKey(rows[3]), 'name:Old Hand');
  assert.ok(f.people.some((p) => p.id === w.checkoutPersonKey(rows[3])));
});

test('photo paths stay inside the item folder', () => {
  const id = '8f1c3c1e-0000-4000-8000-000000000001';
  const p = w.warehousePhotoPaths(id, 'mfx12abcd');
  assert.equal(p.photo, `items/${id}/mfx12abcd.jpg`);
  assert.equal(p.thumb, `items/${id}/mfx12abcd_thumb.jpg`);
  assert.equal(w.isWarehousePhotoPathFor(id, p.photo), true);
  assert.equal(w.isWarehousePhotoPathFor(id, p.thumb), true);
  assert.equal(w.isWarehousePhotoPathFor('other-item', p.photo), false);
  assert.equal(w.isWarehousePhotoPathFor(id, `items/${id}/../x/evil.jpg`), false);
  assert.equal(w.isWarehousePhotoPathFor(id, `items/${id}/photo.png`), false);
  assert.equal(w.isWarehousePhotoPathFor(id, null), false);
});

test('only admins and warehouse staff manage photos', () => {
  for (const role of ['owner', 'precon_manager', 'office_admin']) {
    assert.equal(canManageWarehouse({ role }), true, role);
  }
  assert.equal(canManageWarehouse({ role: 'project_manager', employeeTitle: 'Warehouse Manager/Runner' }), true, 'Rick');
  assert.equal(canManageWarehouse({ role: 'field', employeeTitle: 'Runner' }), true, 'a runner');
  assert.equal(canManageWarehouse({ role: 'project_manager', employeeTitle: 'Field Lead' }), false, 'Howie');
  assert.equal(canManageWarehouse({ role: 'field', employeeTitle: 'Lead Carpenter' }), false);
  assert.equal(canManageWarehouse({ role: 'field', employeeTitle: 'Runner', employeeActive: false }), false, 'inactive runner');
  assert.equal(canManageWarehouse({}), false);
});
