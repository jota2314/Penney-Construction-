const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');

function load(path, imports = {}, expose = []) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code + expose.map(name => `\nexports.${name} = ${name};`).join(''), { exports, require: (name) => {
    if (name in imports) return imports[name];
    throw new Error(`Unexpected import ${name}`);
  }, Date, Map, Set });
  return exports;
}
const tm = load('src/lib/portal/time-materials.ts');
const { loadPortalData } = load('src/lib/portal/load-portal-data.ts', {
  './time-materials': tm,
  '@/lib/schedule/cascade': { cascadeSchedule: () => new Map() },
  '@/lib/schedule/progress': { isMasterPhase: () => true },
  '@/lib/image/transform-signed-url': { signThumbUrls: async () => new Map() },
  '@/lib/storage/signed-url-cache': { cachedSignedUrls: async () => ({ data: [] }) },
});
const json = (value) => JSON.parse(JSON.stringify(value));
const baseRow = {
  id: 'entry', project_id: 'project', change_order_id: 'tm-co', work_date: '2026-10-23',
  category: 'labor', description: 'Slab removal', quantity: '1.125', unit: 'hours', unit_rate: '80.125',
  amount: '90.14', status: 'published', published_at: '2026-10-23T12:00:00Z', void_reason: null,
  source_id: 'private-source', source_snapshot: { payroll_cost: 30, note: 'internal' },
};

test('client projection hides drafts, unpublished voids, other COs and internal source data', () => {
  const rows = [baseRow,
    { ...baseRow, id: 'draft', status: 'draft', published_at: null },
    { ...baseRow, id: 'unpublished', status: 'published', published_at: null },
    { ...baseRow, id: 'void-draft', status: 'void', published_at: null },
    { ...baseRow, id: 'void-shared', status: 'void', void_reason: 'Duplicate entry' },
    { ...baseRow, id: 'other-co', change_order_id: 'private-co' },
  ];
  const entries = json(tm.projectPortalTMEntries(rows, 'tm-co', false));
  assert.deepEqual(entries.map((entry) => entry.id), ['entry', 'void-shared']);
  assert.equal(entries[1].void_reason, 'Duplicate entry');
  assert.equal(entries[0].quantity, 1.125);
  assert.equal(entries[0].unit_rate, 80.125);
  assert.deepEqual(Object.keys(entries[0]).sort(), ['id', 'work_date', 'category', 'description', 'quantity', 'unit', 'unit_rate', 'amount', 'status', 'published_at', 'void_reason'].sort());
  const preview = json(tm.projectPortalTMEntries(rows, 'tm-co', true));
  assert.deepEqual(preview.map((entry) => entry.id), ['entry', 'draft', 'void-shared']);
});

test('running totals retain penny precision and exclude drafts and voids; pending rates stay pending', () => {
  const rows = [
    baseRow,
    { ...baseRow, id: 'material', category: 'material', quantity: '3', unit: 'bags', unit_rate: '12.3456', amount: '37.04' },
    { ...baseRow, id: 'equipment', category: 'equipment', quantity: '1', unit: 'day', unit_rate: '25', amount: '25' },
    { ...baseRow, id: 'pending', unit_rate: null, amount: null, quantity: '0.25' },
    { ...baseRow, id: 'draft', status: 'draft', amount: '999' },
    { ...baseRow, id: 'void', status: 'void', amount: '888' },
  ];
  const summary = json(tm.summarizePortalTM(tm.projectPortalTMEntries(rows, 'tm-co', true)));
  assert.equal(summary.total, 152.18);
  assert.equal(summary.hours, 1.375);
  assert.equal(summary.categories.material, 37.04);
  assert.equal(summary.entryCount, 4);
  assert.equal(summary.pendingRates, 1);
  assert.equal(summary.draftCount, 1);
  const pending = tm.projectPortalTMEntries([rows[3]], 'tm-co', false)[0];
  assert.equal(pending.unit_rate, null);
  assert.equal(pending.amount, null);
});

function database({ ledgerError = false, entries = [baseRow], paymentAmount = 1000, withTimeMaterials = true } = {}) {
  const calls = [];
  const commonCO = { project_id: 'project', change_order_number: 1, title: 'Slab replacement', description: '', status: 'approved', client_signed_at: '2026-10-23', sent_to_client_at: null, approval_token: 'approval' };
  const tables = {
    projects: [{ id: 'project', name: 'Fixture project', project_number: 'TEST', address: '', contract_value: 10000 }],
    change_orders: [
      { ...commonCO, id: 'tm-co', billing_type: 'time_materials', price_impact: 9999, tm_terms: 'Actual measured work' },
      { ...commonCO, id: 'fixed-co', billing_type: 'fixed_price', price_impact: 250 },
      { ...commonCO, id: 'hidden-co', billing_type: 'time_materials', status: 'draft', client_signed_at: null },
      { ...commonCO, id: 'sent-co', billing_type: 'time_materials', status: 'submitted', sent_to_client_at: '2026-10-23', client_signed_at: null, price_impact: 0 },
      { ...commonCO, id: 'other-project-co', project_id: 'other-project', billing_type: 'time_materials' },
    ],
    payments_received: [{ project_id: 'project', id: 'payment', payment_type: 'deposit', amount: paymentAmount }],
    change_order_tm_entries: entries,
  };
  if (!withTimeMaterials) tables.change_orders = tables.change_orders.filter(co => co.billing_type === 'fixed_price');
  return { calls, from(table) {
    let rows = tables[table] ?? [];
    let single = false;
    let range = null;
    const call = { table, operations: [] };
    calls.push(call);
    const q = {
      select(value) { call.select = value; return q; },
      eq(key, value) { call.operations.push(['eq', key, value]); rows = rows.filter((row) => row[key] === value); return q; },
      neq(key, value) { rows = rows.filter((row) => row[key] !== value); return q; },
      in(key, values) { call.operations.push(['in', key, [...values]]); rows = rows.filter((row) => values.includes(row[key])); return q; },
      not(key, op, value) { call.operations.push(['not', key, op, value]); rows = rows.filter((row) => row[key] != null); return q; },
      or(value) { call.operations.push(['or', value]); if (table === 'change_orders') rows = rows.filter((row) => row.sent_to_client_at != null || row.status === 'approved'); return q; },
      order() { return q; }, is() { return q; }, lte() { return q; }, gte() { return q; }, limit() { return q; },
      range(from, to) { range = [from, to]; return q; },
      single() { single = true; return q; },
      then(resolve) { return Promise.resolve({ data: single ? rows[0] : range ? rows.slice(range[0], range[1] + 1) : rows, error: table === 'change_order_tm_entries' && ledgerError ? { message: 'fixture error' } : null }).then(resolve); },
    };
    return q;
  } };
}

test('portal queries are project/eligible-CO scoped and only published ledger enters financial display', async () => {
  const db = database({ entries: [baseRow,
    { ...baseRow, id: 'hidden', change_order_id: 'hidden-co' },
    { ...baseRow, id: 'draft', status: 'draft', published_at: null },
    { ...baseRow, id: 'wrong-project', project_id: 'other-project' },
  ] });
  const result = await loadPortalData(db, { projectId: 'project', mode: 'client', token: 'fixture-token' });
  assert.equal(result.financials.adjusted_contract, 10250);
  assert.equal(result.financials.outstanding_receivable, null);
  assert.equal(result.financials.change_order_count, 1);
  assert.deepEqual(json(result.change_orders.map((co) => co.id)), ['tm-co', 'fixed-co', 'sent-co']);
  assert.deepEqual(json(result.change_orders[0].tm_entries.map((row) => row.id)), ['entry']);
  const ledger = db.calls.find((call) => call.table === 'change_order_tm_entries');
  assert.ok(!ledger.select.includes('*') && !ledger.select.includes('source'));
  assert.deepEqual(ledger.operations.find((op) => op[0] === 'eq'), ['eq', 'project_id', 'project']);
  assert.deepEqual(ledger.operations.find((op) => op[1] === 'change_order_id'), ['in', 'change_order_id', ['tm-co', 'sent-co']]);
  assert.ok(result.documents.find((doc) => doc.id === 'co-tm-co').subtitle.includes('Time & materials'));
  assert.ok(result.needed.find((need) => need.kind === 'change_order').detail.includes('Time & materials'));
});

test('staff preview retains draft labels but never adds their charges to the client total', async () => {
  const db = database({ entries: [baseRow, { ...baseRow, id: 'draft', status: 'draft', published_at: null, amount: '500' }] });
  const result = await loadPortalData(db, { projectId: 'project', mode: 'preview' });
  const entries = result.change_orders[0].tm_entries;
  assert.deepEqual(json(entries.map((entry) => entry.status)), ['published', 'draft']);
  assert.equal(tm.summarizePortalTM(entries).total, 90.14);
  assert.ok(!result.change_orders.some((co) => co.id === 'hidden-co'));
});

test('a ledger query failure stays distinct from an empty or zero-dollar ledger', async () => {
  const result = await loadPortalData(database({ ledgerError: true }), { projectId: 'project', mode: 'client' });
  assert.equal(result.change_orders[0].tm_entries, null);
  const empty = await loadPortalData(database({ entries: [] }), { projectId: 'project', mode: 'client' });
  assert.deepEqual(json(empty.change_orders[0].tm_entries), []);
});

test('a long ledger loads every page instead of silently understating recorded charges', async () => {
  const entries = Array.from({ length: 1001 }, (_, index) => ({ ...baseRow, id: `line-${index}`, amount: '0.01', quantity: '0.0001' }));
  const db = database({ entries });
  const result = await loadPortalData(db, { projectId: 'project', mode: 'client' });
  assert.equal(result.change_orders[0].tm_entries.length, 1001);
  assert.equal(tm.summarizePortalTM(result.change_orders[0].tm_entries).total, 10.01);
  assert.equal(db.calls.filter((call) => call.table === 'change_order_tm_entries').length, 2);
});

test('client cards show pending work without a misleading fixed $0 and explain corrected entries', () => {
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TimeMaterialsSection } = load('src/components/portal/time-materials-section.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@/lib/money': load('src/lib/money.ts'),
    '@/lib/portal/time-materials': tm,
  });
  const order = { id: 'tm-co', change_order_number: 1, title: 'Slab replacement', billing_type: 'time_materials', tm_terms: 'Actual measured work', status: 'approved', tm_entries: [] };
  const empty = renderToStaticMarkup(createElement(TimeMaterialsSection, { changeOrders: [order] }));
  assert.match(empty, /Pending/);
  assert.doesNotMatch(empty, /\$0\.00/);
  assert.match(empty, /separate from the contract value shown above/);
  const entries = tm.projectPortalTMEntries([baseRow, { ...baseRow, id: 'void', status: 'void', void_reason: 'Duplicate entry' }], order.id, false);
  const shared = renderToStaticMarkup(createElement(TimeMaterialsSection, { changeOrders: [{ ...order, tm_entries: entries }] }));
  assert.match(shared, /1\.125 labor hours/);
  assert.match(shared, /\$80\.125/);
  assert.match(shared, /Voided · excluded from total/);
  assert.match(shared, /Duplicate entry/);
  const unavailable = renderToStaticMarkup(createElement(TimeMaterialsSection, { changeOrders: [{ ...order, tm_entries: null }] }));
  assert.match(unavailable, /temporarily unavailable/);
  assert.doesNotMatch(unavailable, /\$0\.00/);
});

test('T&M payments do not imply a false base-contract balance or payment progress', async () => {
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const money = load('src/lib/money.ts');
  const tmComponent = load('src/components/portal/time-materials-section.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'), '@/lib/money': money, '@/lib/portal/time-materials': tm,
  });
  const { PaymentsCard, PaymentsTab } = load('src/components/portal/client-portal-view.tsx', {
    react: require('react'), 'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': require('lucide-react'), '@/lib/money': money,
    '@/lib/schedule/progress': {}, '@/lib/schedule/health': {}, './portal-font': { portalFont: { className: '' } },
    './time-materials-section': tmComponent,
  }, ['PaymentsCard', 'PaymentsTab']);
  // The $11,000 includes payment for T&M invoices, while fixed contract value
  // remains $10,250. There is no evidence to allocate those receipts to the base.
  const data = await loadPortalData(database({ paymentAmount: 11000 }), { projectId: 'project', mode: 'client' });
  assert.equal(data.financials.adjusted_contract, 10250);
  assert.equal(data.financials.total_payments_received, 11000);
  assert.equal(data.financials.outstanding_receivable, null);
  for (const Component of [PaymentsCard, PaymentsTab]) {
    const html = renderToStaticMarkup(createElement(Component, { data, onOpen() {}, mailto: 'mailto:fixture@example.invalid' }));
    assert.match(html, /Contract value \(excludes T&amp;M\)/);
    assert.match(html, /Project payments received/);
    assert.match(html, /\$11,000\.00/);
    assert.doesNotMatch(html, /of your contract paid|>Balance<|width:100%|-\$750\.00|\+\$0\.00/);
  }
  const fixed = await loadPortalData(database({ withTimeMaterials: false }), { projectId: 'project', mode: 'client' });
  assert.equal(fixed.financials.outstanding_receivable, 9250);
  const home = renderToStaticMarkup(createElement(PaymentsCard, { data: fixed, onOpen() {} }));
  assert.match(home, /10% of your contract paid/);
  const detail = renderToStaticMarkup(createElement(PaymentsTab, { data: fixed, mailto: 'mailto:fixture@example.invalid' }));
  assert.match(detail, />Contract total</);
  assert.match(detail, />Paid to date</);
  assert.match(detail, />Balance</);
  assert.match(detail, /\$9,250\.00/);
});
