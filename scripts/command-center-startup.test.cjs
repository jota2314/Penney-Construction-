/* eslint-disable @typescript-eslint/no-require-imports */
// Run the real server actions and client hook with gated query results; no live writes or UI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function('exports', 'require', code)(exports, (name) => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  });
  return exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

function feedHarness() {
  const starts = [], queries = [], gates = new Map();
  const begin = (name) => { starts.push(name); const gate = deferred(); gates.set(name, gate); return gate.promise; };
  const client = { from(table) {
    const query = { table, ops: [] };
    queries.push(query);
    const chain = new Proxy({}, { get(_, method) {
      if (method === 'then') return (yes, no) => begin(`query:${table}:${query.ops.some(([m, , options]) => m === 'select' && options?.head) ? 'count' : 'rows'}`).then(yes, no);
      return (...args) => { query.ops.push([method, ...args]); return chain; };
    } });
    return chain;
  } };
  const fn = load('src/lib/actions/command-center-feed.ts', {
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/crew/time-entries-compat': { fetchTimeEntriesCompat: (_, options) => begin(options.open ? 'open-shifts' : 'closed-shifts') },
    '@/lib/auth/rate-visibility': {
      getRateVisibility: () => begin('rate-visibility'),
      maskTimeEntryRates: (visibility, rows) => { assert.equal(visibility.checked, true); return rows.map((row) => ({ ...row, employees: { ...row.employees, hourly_rate: null } })); },
    },
    '@/lib/actions/command-center-updates': { getCommandCenterUpdatesPage: (cursor) => { assert.equal(cursor, null); return begin('first-20-updates'); } },
    '@/lib/actions/decisions': { getPendingDecisions: () => begin('decisions') },
  }).getCommandCenterFeedData;
  const resolve = (name, value) => { assert(gates.has(name), `${name} started`); gates.get(name).resolve(value); };
  function finish({ failedUpdates = false } = {}) {
    if (failedUpdates) gates.get('first-20-updates').reject(new Error('temporary failure'));
    else resolve('first-20-updates', { items: [{ type: 'logPost', log: { id: 'photo-from-qr' } }], nextCursor: 'next-20' });
    resolve('decisions', []);
    resolve('rate-visibility', { checked: true });
    resolve('open-shifts', [{ id: 'open', clock_in: '2026-11-04T10:00:00Z', employees: { first_name: 'Test', last_name: 'Worker', hourly_rate: 50 }, projects: { name: 'Project' } }]);
    resolve('closed-shifts', [
      { clock_in: '2026-11-04T10:00:00Z', clock_out: '2026-11-04T12:00:00Z', employees: { hourly_rate: 50 } },
      { clock_in: '2026-11-04T10:00:00Z', clock_out: '2026-11-04T09:00:00Z', employees: { hourly_rate: 50 } },
    ]);
    resolve('query:todos:rows', { data: [], error: null });
    resolve('query:payments_received:rows', { data: [{ amount: 500 }, { amount: null }, { amount: '125.50' }], error: null });
    resolve('query:invoices:rows', { data: [
      { amount: 200, paid_amount: 75, payment_method: 'check' },
      { amount: 100, paid_amount: 0, payment_method: 'check' },
      { amount: 999, paid_amount: 999, payment_method: 'capital_one' },
      { amount: 999, paid_amount: 999, payment_method: 'internal' },
    ], error: null });
    resolve('query:invoices:count', { count: 3, error: null });
    resolve('query:payments_received:count', { count: 2, error: null });
  }
  return { fn, starts, queries, gates, finish };
}

test('all 10 first-feed operations start in one dependency wave; no desktop schedule or media work', async () => {
  const h = feedHarness();
  let completed = false;
  const result = h.fn('owner', 'impersonated-viewer').then((value) => { completed = true; return value; });
  await flush();
  assert.equal(completed, false, 'all I/O is gated');
  assert.equal(h.starts.length, 10, 'independent first-page, rate, attendance, approvals and five tile queries all started');
  assert.deepEqual(h.queries.map((q) => q.table).sort(), ['invoices', 'invoices', 'payments_received', 'payments_received', 'todos']);
  assert(h.queries.find((q) => q.table === 'todos').ops.some((op) => op[0] === 'eq' && op[1] === 'created_by' && op[2] === 'impersonated-viewer'));
  const receipts = h.queries.find((q) => q.table === 'invoices' && !q.ops.some((op) => op[2]?.head));
  assert(receipts.ops.some((op) => op[0] === 'eq' && op[1] === 'payment_status' && op[2] === 'paid'));
  h.finish();
  const value = await result;
  assert.equal(value.initialUpdates.items.length, 1);
  assert.equal(value.initialUpdates.nextCursor, 'next-20');
  assert.equal(value.jobsites, undefined, 'jobsite schedules are absent from first-page data');
  assert.equal(value.feed.some((item) => ['logPost', 'companyPost', 'punchGroupPost'].includes(item.type)), false);
  assert.deepEqual(value.feed.find((item) => item.type === 'receiptCapture'), { type: 'receiptCapture', weekTotal: 175, flaggedCount: 3 });
  assert.deepEqual(value.feed.find((item) => item.type === 'depositCapture'), { type: 'depositCapture', weekTotal: 625.5, flaggedCount: 2 });
  const live = value.feed.find((item) => item.type === 'liveMap');
  assert.equal(live.completedTodayCents, 10000);
  assert.equal(live.activeShifts[0].rateCentsPerHour, 0, 'individual rates pass through the permission mask');
  assert.equal(live.showSpend, true);
});

test('initial timeline failure stays retryable and crew finance visibility is preserved', async () => {
  const h = feedHarness();
  const result = h.fn('crew', 'crew-viewer');
  await flush();
  h.finish({ failedUpdates: true });
  const value = await result;
  assert.equal(value.initialUpdates, null);
  assert.equal(value.feed.find((item) => item.type === 'liveMap').showSpend, false);
  assert.equal(value.feed.find((item) => item.type === 'receiptCapture').weekTotal, 175);
});

test('route returns the authenticated greeting boundary before querying dashboard data', async () => {
  let dataStarts = 0;
  const dataGate = deferred();
  const page = load('src/app/(app)/command-center/page.tsx', {
    react: { Suspense: 'Suspense' }, 'react/jsx-runtime': jsx,
    '@/lib/auth/require-auth': { requireAuth: async () => ({ id: 'real-user', profile: { id: 'viewed-user', full_name: 'Jorge Example', role: 'owner' } }) },
    '@/components/field-feed/command-center-feed': { CommandCenterFeed: 'CommandCenterFeed' },
    '@/components/field-feed/command-center-loading': { CommandCenterLoading: 'CommandCenterLoading' },
    '@/lib/actions/command-center-feed': { getCommandCenterFeedData: (role, id) => { assert.equal(id, 'viewed-user'); assert.equal(role, 'owner'); dataStarts++; return dataGate.promise; } },
    '@/lib/actions/website-inquiries': { getWebsiteInquirySummary: async () => null },
    '@/lib/inquiries/model': { canManageWebsiteInquiries: () => false },
    '@/lib/actions/command-center-updates': { getCommandCenterFocusedUpdate: async (id) => ({ type: 'logPost', log: { id } }) },
  }).default;
  const shell = await page({ searchParams: Promise.resolve({ post: 'older-post' }) });
  assert.equal(shell.type, 'Suspense');
  assert.equal(shell.props.fallback.props.firstName, 'Jorge');
  assert.equal(dataStarts, 0, 'the async body is behind Suspense');
  const content = shell.props.children.type(shell.props.children.props);
  await flush();
  assert.equal(dataStarts, 1);
  dataGate.resolve({ feed: [], initialUpdates: { items: [], nextCursor: null } });
  const body = await content;
  assert.equal(body.key, 'viewed-user', 'viewer switches remount client caches');
  assert.equal(body.props.focusedUpdate.log.id, 'older-post');
});

test('loading shell shows no invented metrics or fixed overlay', () => {
  const Loading = load('src/components/field-feed/command-center-loading.tsx', { 'react/jsx-runtime': jsx }).CommandCenterLoading;
  const html = renderToStaticMarkup(jsx.jsx(Loading, { firstName: 'Jorge' }));
  assert.match(html, /Jorge/);
  assert.match(html, /Loading your Command Center/);
  assert.doesNotMatch(html, /\$0|fixed|inset-0/);
});

function hookHarness() {
  const state = [], effects = [], calls = [];
  let index = 0, enabled = false, refreshKey = {}, result;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], (value) => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
    useCallback(fn) { index++; return fn; },
    useEffect(fn, deps) { const slot = index++; const prior = effects[slot]; if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) { prior?.cleanup?.(); effects[slot] = { deps, run: fn }; } },
  };
  const hook = load('src/components/field-feed/use-command-center-jobsites.ts', {
    react: hooks,
    '@/lib/actions/command-center-jobsites': { getCommandCenterJobsites: () => { const request = deferred(); calls.push(request); return request.promise; } },
  }).useCommandCenterJobsites;
  function render() {
    index = 0; result = hook(enabled, refreshKey);
    for (const effect of effects) if (effect?.run) { const run = effect.run; delete effect.run; effect.cleanup = run(); }
    return result;
  }
  return { calls, render, desktop: (value) => { enabled = value; return render(); }, refresh: () => { refreshKey = {}; return render(); }, result: () => result, unmount: () => effects.forEach((effect) => effect?.cleanup?.()) };
}

test('jobsite hook never fetches on mobile, preserves loaded rail on failures, retries and ignores stale replies', async () => {
  const h = hookHarness();
  h.render(); h.refresh();
  assert.equal(h.calls.length, 0);
  assert.equal(h.desktop(true).loading, true);
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve([{ id: 'first' }]); await flush();
  assert.deepEqual(h.render().jobsites, [{ id: 'first' }]);
  h.refresh(); h.calls[1].reject(new Error('temporary')); await flush();
  assert.deepEqual(h.render().jobsites, [{ id: 'first' }]);
  assert.equal(h.result().error, 'Jobsites could not load.');
  h.result().retry(); h.render();
  assert.equal(h.calls.length, 3);
  h.refresh();
  h.calls[3].resolve([{ id: 'latest' }]); await flush();
  h.calls[2].resolve([{ id: 'stale' }]); await flush();
  assert.deepEqual(h.render().jobsites, [{ id: 'latest' }]);
  h.refresh(); h.desktop(false); h.calls[4].resolve([{ id: 'after-mobile' }]); await flush();
  assert.deepEqual(h.render().jobsites, [{ id: 'latest' }]);
  h.refresh(); assert.equal(h.calls.length, 5);
  h.unmount();
});
