/* eslint-disable @typescript-eslint/no-require-imports -- Standalone regression test. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function service(notices) {
  const cache = new Map();
  function load(file) {
    const absolute = path.resolve(file);
    if (cache.has(absolute)) return cache.get(absolute);
    const module = { exports: {} };
    cache.set(absolute, module.exports);
    const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', source)(specifier => {
      if (specifier === '@/lib/notifications/tagged-mentions') return { notifyBillApprovedForPay: async notice => notices.push(notice) };
      if (specifier === '@/lib/auth/role-access') return { BILL_PAY_APPROVER_NAMES: 'Approver', canApproveBillPay: email => email === 'approver@example.test' };
      const target = specifier.startsWith('@/') ? path.join('src', specifier.slice(2)) : path.join(path.dirname(absolute), specifier);
      return load(`${target}.ts`);
    }, module, module.exports);
    return module.exports;
  }
  return load('src/lib/finance/pay-approval-service.ts');
}

function database(invoices, beforeUpdate = () => {}) {
  const updates = [];
  return {
    updates,
    from(table) {
      let predicates = [], patch = null;
      const query = {
        select() { return query; },
        eq(key, value) { predicates.push(row => row[key] === value); return query; },
        is(key, value) { predicates.push(row => (row[key] ?? null) === value); return query; },
        in(key, values) { predicates.push(row => values.includes(row[key])); return query; },
        or(expression) {
          assert.equal(expression, 'payment_status.is.null,payment_status.neq.paid');
          predicates.push(row => row.payment_status == null || row.payment_status !== 'paid');
          return query;
        },
        update(value) { beforeUpdate(invoices); patch = value; return query; },
        order() { return query; },
        limit() { return query; },
        maybeSingle() { return Promise.resolve({ data: { id: 'actor', email: 'approver@example.test', full_name: 'Approver', role: 'owner' }, error: null }); },
        then(resolve, reject) {
          assert.equal(table, 'invoices');
          const rows = invoices.filter(row => predicates.every(predicate => predicate(row)));
          if (patch) for (const row of rows) { Object.assign(row, patch); updates.push(row.id); }
          return Promise.resolve({ data: rows.map(row => ({ ...row })), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}
const bill = (id, extra = {}) => ({
  id, vendor_name: 'Supplier', amount: 125, paid_amount: 0, payment_status: 'unpaid',
  project_id: 'job', estimate_line_item_id: 'line', source: 'office_entry', review_status: 'ok',
  invoice_date: '2026-10-01', invoice_number: id, non_job_reason: null, ...extra,
});

test('approval lists and actions exclude resolved non-job money while ordinary bills remain payable', async () => {
  const notices = [], api = service(notices);
  const db = database([bill('ordinary'), bill('draw', { non_job_reason: 'owner_draw' }), bill('transfer', { non_job_reason: 'card_payment_transfer' })]);
  const list = await api.listBillsAwaitingApproval(db, 'actor');
  assert.equal(list.count, 1);
  assert.deepEqual(list.awaiting_approval[0].invoice_ids, ['ordinary']);
  await assert.rejects(api.approveBillsForPayAsActor(db, 'actor', ['draw']), error => error.status === 404);
  await assert.rejects(api.approveBillsForPayAsActor(db, 'actor', ['ordinary', 'transfer']), error => error.status === 404);
  assert.deepEqual(db.updates, []);
  const approved = await api.approveBillsForPayAsActor(db, 'actor', ['ordinary']);
  assert.deepEqual(approved.approved_ids, ['ordinary']);
  assert.equal(approved.approved_amount, 125);
  assert.equal(notices.length, 1);
});

test('classification between fetch and update cannot approve or notify a non-job transaction', async () => {
  const notices = [], api = service(notices);
  const db = database([bill('raced')], rows => { rows[0].non_job_reason = 'card_payment_transfer'; });
  const result = await api.approveBillsForPayAsActor(db, 'actor', ['raced']);
  assert.deepEqual(result.approved_ids, []);
  assert.equal(result.approved_amount, 0);
  assert.deepEqual(db.updates, []);
  assert.deepEqual(notices, []);
});
