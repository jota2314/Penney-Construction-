/* eslint-disable @typescript-eslint/no-require-imports -- Standalone regression test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { buildDailyLog, logTotals, validMonth } = require('../src/lib/finance/daily-log.ts');
const { canAccessPath } = require('../src/lib/auth/role-access.ts');
const base = { id: 'a', project_id: 'job', amount: 100, description: 'Materials', source: 'office_entry', review_status: 'ok', projects: { name: 'Sample addition', project_number: 'DEMO-01' }, vendor_name: 'Sample supplier', invoice_number: '100', invoice_date: '2026-09-18', split_group_id: null, payment_status: 'unpaid', payment_method: 'check', duplicate_of_id: null };
const payment = { id: 'income', project_id: 'job', amount: 1500.25, description: 'Progress payment', source: 'manual', review_status: 'ok', projects: base.projects, payer_name: 'Sample customer', received_date: '2026-09-18', reference_number: '123', method: 'check' };
let rows = buildDailyLog([
  { ...base, split_group_id: 'split', amount: 60.10 },
  { ...base, id: 'b', split_group_id: 'split', amount: 39.90 },
  { ...base, id: 'credit', invoice_number: 'credit', amount: -25.15 },
  { ...base, id: 'retired', duplicate_of_id: 'a' },
  { ...base, id: 'internal', payment_method: 'internal' },
  { ...base, id: 'qb', source: 'qb_import' },
], [payment, { ...payment, id: 'qb-payment', source: 'qb_import' }]);
assert.equal(rows.length, 3);
assert.equal(rows.find(r => r.id === 'expense:a').allocations, 2);
assert.deepEqual(logTotals(rows), { income: 1500.25, expenses: 74.85, difference: 1425.40, review: 0 });
rows = buildDailyLog([base, { ...base, id: 'repeat' }], []);
assert.equal(rows.length, 1);
assert.equal(rows[0].amount, 100);
assert.equal(rows[0].review, true);
assert.equal(logTotals(rows).expenses, 0);
rows = buildDailyLog([base, { ...base, id: 'conflict', amount: 200 }], []);
assert.equal(rows[0].amount, null);
assert.equal(logTotals(rows).review, 1);
assert.equal(buildDailyLog([{ ...base, amount: null }], [])[0].review, true);
assert.equal(buildDailyLog([{ ...base, invoice_date: null }], [])[0].date, null);
const mixedDate = buildDailyLog([{ ...base, split_group_id: 'mixed' }, { ...base, id: 'other-date', split_group_id: 'mixed', invoice_date: '2026-08-01' }], [])[0];
assert.equal(mixedDate.date, null);
assert.equal(mixedDate.review, true);
assert.equal(buildDailyLog([], [{ ...payment, review_status: 'needs_review' }])[0].review, true);
assert.equal(validMonth('2026-13', '2026-09-19'), '2026-09');
assert.equal(validMonth('2024-02', '2026-09-19'), '2024-02');
for (const role of ['field', 'project_manager', null]) assert.equal(canAccessPath({ role }, '/finances/daily-log'), false);
assert.equal(canAccessPath({ role: 'owner' }, '/finances/daily-log'), true);
console.log('PASS: splits, credits, duplicate/conflicting submissions, exclusions, review, missing dates, month validation and access');

if (process.argv.includes('--browser')) browserTest().catch(e => { console.error(e); process.exitCode = 1; });
async function browserTest() {
  // npm install --prefix .finance-preview --no-save esbuild
  const esbuild = require(process.env.ESBUILD_PATH || '../.finance-preview/node_modules/esbuild');
  const http = require('node:http');
  const { chromium, expect } = require('@playwright/test');
  const dir = path.resolve('.finance-preview');
  fs.mkdirSync(dir, { recursive: true });
  const fixture = buildDailyLog([
    base,
    { ...base, id: 'credit', invoice_number: 'credit', amount: -25.15, invoice_date: '2026-09-17' },
    { ...base, id: 'review', invoice_number: 'review', amount: 222, review_status: 'needs_review', vendor_name: 'Review supplier' },
  ], [payment]);
  fs.writeFileSync(path.join(dir, 'entry.jsx'), `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { FinancialDailyLog } from '@/components/finances/financial-daily-log';
    import { FinanceTabs } from '@/components/finances/finance-tabs';
    createRoot(document.getElementById('root')).render(<main className="p-4 flex flex-col gap-5 max-w-6xl mx-auto"><FinanceTabs current="daily"/><FinancialDailyLog records={${JSON.stringify(fixture)}} month="2026-09" today="2026-09-19" failed={location.search.includes('failed')}/></main>);
  `);
  fs.writeFileSync(path.join(dir, 'mocks.jsx'), `import React from 'react'; export default function Link({href,children,...props}) {return <a href={href} {...props}>{children}</a>}; export const useRouter=()=>({refresh(){}}); export const BillDrop=()=> <p>Existing bill workflow</p>; export const DepositCapture=()=> <p>Existing income workflow</p>;`);
  await esbuild.build({ entryPoints: [path.join(dir, 'entry.jsx')], bundle: true, outfile: path.join(dir,'bundle.js'), jsx: 'automatic', alias: { '@': path.resolve('src') }, plugins: [{ name: 'read-only-fixture', setup(build) { build.onResolve({ filter: /^(next\/(link|navigation)|@\/components\/(invoices\/bill-drop|field-feed\/deposit-capture))$/ }, () => ({path: path.join(dir,'mocks.jsx')})); } }] });
  const css = await require('postcss')([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css','utf8'), {from: path.resolve('src/app/globals.css')});
  fs.writeFileSync(path.join(dir,'style.css'),css.css);
  const server = http.createServer((req,res) => {
    if (req.url.startsWith('/bundle.js') || req.url.startsWith('/style.css')) {res.setHeader('Content-Type', req.url.includes('.css') ? 'text/css' : 'application/javascript'); res.end(fs.readFileSync(path.join(dir,req.url.slice(1))));}
    else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    const url=`http://127.0.0.1:${server.address().port}`;
    for (const width of [390,1280]) {
      await page.setViewportSize({width,height:1000}); await page.goto(url);
      await expect(page.getByRole('heading',{name:'Financial Daily Log'})).toBeVisible();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
      await page.screenshot({path:path.join(dir,`daily-log-${width}.png`),fullPage:true});
      await page.getByLabel('Transaction type').selectOption('income');
      await expect(page.locator('article')).toHaveCount(1);
      await page.getByRole('button',{name:'Clear filters'}).click();
      await page.getByLabel('Search', {exact:true}).fill('Review supplier');
      await expect(page.locator('article')).toHaveCount(1);
      await page.getByRole('button',{name:'Clear filters'}).click();
      await page.getByLabel('Specific day').fill('2026-09-17');
      await expect(page.locator('article')).toHaveCount(1);
      await expect(page.locator('article')).toContainText('-$25.15');
      await page.getByRole('button',{name:'Clear filters'}).click();
      await page.getByLabel('Job',{exact:true}).selectOption('unassigned');
      await expect(page.getByText('No transactions for this selection')).toBeVisible();
      await page.getByRole('button',{name:'+ Add expense',exact:true}).click();
      await expect(page.getByText('Existing bill workflow')).toBeVisible();
      await page.getByRole('button',{name:'+ Record income',exact:true}).click();
      await expect(page.getByText('Existing income workflow')).toBeVisible();
    }
    await page.goto(url+'?failed');
    await expect(page.getByRole('alert')).toContainText('couldn’t load');
    await expect(page.getByText('Income received',{exact:true})).toHaveCount(0);
    assert.deepEqual(errors,[]);
    console.log('PASS: mobile/desktop overflow, filters, empty/error states, capture entry points. Screenshots: .finance-preview/');
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
}
