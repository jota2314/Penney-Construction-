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
  // Stress only the presentation: the ordinary fixture keeps its original
  // credit and review totals, and all records stay inside this local preview.
  const longVendor = 'Metropolitan Architectural Restoration and Specialized Construction Supply Company';
  const stressFixture = buildDailyLog([{
    ...base, id: 'large', invoice_number: 'LARGE-100', amount: 12345678.90,
    invoice_date: '2026-09-16', vendor_name: longVendor,
    projects: { name: 'A very long waterfront addition and complete historic property restoration', project_number: 'DEMO-LONG-01' },
    description: 'Special-order materials and installation for the complete property restoration.',
  }], []);
  assert.deepEqual(logTotals(fixture), { income: 1500.25, expenses: 74.85, difference: 1425.40, review: 1 });
  fs.writeFileSync(path.join(dir, 'entry.jsx'), `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { FinancialDailyLog } from '@/components/finances/financial-daily-log';
    import { FinanceTabs } from '@/components/finances/finance-tabs';
    import { DailyLogPanel } from '@/components/finances/daily-log-panel';
    import { PaymentReviewList } from '@/components/projects/payment-review-list';
    const records = location.search.includes('stress') ? [...${JSON.stringify(fixture)}, ...${JSON.stringify(stressFixture)}] : ${JSON.stringify(fixture)};
    createRoot(document.getElementById('root')).render(<main className="p-4 flex flex-col gap-5 max-w-6xl mx-auto"><FinanceTabs current="daily"/><FinancialDailyLog records={records} month="2026-09" today="2026-09-19" failed={location.search.includes('failed')}/>{location.search.includes('payment') && <DailyLogPanel title="Manage income payment" month="2026-09"><PaymentReviewList manage payments={[${JSON.stringify({...payment, payment_type:'progress', project_label:'Sample addition', photo_url:null, review_reason:null, created_at:null})}]} jobs={[{id:'job', label:'Sample addition'}]}/></DailyLogPanel>}</main>);
  `);
  fs.writeFileSync(path.join(dir, 'mocks.jsx'), `import React from 'react'; export default function Link({href,children,scroll,...props}) {return <a href={href} {...props}>{children}</a>}; export const useRouter=()=>({refresh(){window.refreshed=true},replace(url){window.closedUrl=url}}); export const BillDrop=()=> <p>Existing bill workflow</p>; export const DepositCapture=()=> <p>Existing income workflow</p>; export async function resolvePayment(input){window.savedPayment=input;return {}}; export async function discardPayment(){throw Error('Unexpected discard')};`);
  await esbuild.build({ entryPoints: [path.join(dir, 'entry.jsx')], bundle: true, outfile: path.join(dir,'bundle.js'), jsx: 'automatic', alias: { '@': path.resolve('src') }, plugins: [{ name: 'read-only-fixture', setup(build) { build.onResolve({ filter: /^(next\/(link|navigation)|@\/lib\/actions\/deposit-capture|@\/components\/(invoices\/bill-drop|field-feed\/deposit-capture))$/ }, () => ({path: path.join(dir,'mocks.jsx')})); } }] });
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
    const noOverflow = async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
        `Page overflows at ${page.viewportSize().width}px`);
    };
    const monthTotal = label => page.getByText(label, {exact:true}).locator('..');
    const filterSummary = () => page.locator('summary').filter({hasText:/^Filters/});
    const openFilters = async () => {
      const summary = filterSummary();
      if (!await summary.locator('..').evaluate(node => node.open)) await summary.click();
      await expect(page.getByLabel('Specific day')).toBeVisible();
    };
    for (const width of [320,390,1280]) {
      await page.setViewportSize({width,height:1000}); await page.goto(url);
      await expect(page.getByRole('heading',{name:'Financial Daily Log'})).toBeVisible();
      await expect(page.locator('article')).toHaveCount(4);
      await expect(page.getByRole('link',{name:'Bills to pay',exact:true})).toHaveAttribute('href','/finances/daily-log?month=2026-09&panel=bills');
      await expect(monthTotal('Income received')).toContainText('$1,500.25');
      await expect(monthTotal('Expenses & bills')).toContainText('$74.85');
      await expect(monthTotal('Income less expenses')).toContainText('$1,425.40');
      await expect(page.getByText('1 transaction needs review · excluded from totals.',{exact:true})).toBeVisible();
      await noOverflow();
      await page.screenshot({path:path.join(dir,`daily-log-${width}.png`),fullPage:true});

      const incomeArticle = page.locator('article').filter({hasText:'Sample customer'});
      const incomeDetails = incomeArticle.locator(':scope > details');
      const incomeSummary = incomeDetails.locator(':scope > summary');
      await expect(incomeDetails).toHaveJSProperty('open',false);
      await expect(incomeSummary).toContainText('Sample customer');
      await expect(incomeSummary).toContainText('$1,500.25');
      await expect(incomeArticle.getByRole('link',{name:'Manage payment',exact:true})).toBeHidden();
      // Native summary controls must work without a pointer and expose their
      // existing management links only when the row is expanded.
      await incomeSummary.focus();
      await page.keyboard.press('Enter');
      await expect(incomeDetails).toHaveJSProperty('open',true);
      await expect(incomeArticle.getByRole('link',{name:'Manage payment',exact:true})).toBeVisible();
      await expect(incomeArticle.getByRole('link',{name:'Manage payment',exact:true})).toHaveAttribute('href','/finances/daily-log?month=2026-09&panel=income&id=income');
      await expect(incomeArticle).toContainText('123');
      await noOverflow();
      await incomeSummary.focus();
      await page.keyboard.press('Space');
      await expect(incomeDetails).toHaveJSProperty('open',false);
      await expect(incomeArticle.getByRole('link',{name:'Manage payment',exact:true})).toBeHidden();

      const reviewArticle = page.locator('article').filter({hasText:'Review supplier'});
      await expect(reviewArticle.locator('summary')).toContainText(/Needs review/i);
      await expect(reviewArticle.getByRole('link',{name:'Review & assign',exact:true})).toBeHidden();
      await reviewArticle.locator('summary').click();
      await expect(reviewArticle.getByRole('link',{name:'Review & assign',exact:true})).toBeVisible();
      await expect(reviewArticle.getByRole('link',{name:'Review & assign',exact:true})).toHaveAttribute('href','/finances/daily-log?month=2026-09&panel=review-expenses&id=review');
      await expect(monthTotal('Expenses & bills')).toContainText('$74.85');
      await noOverflow();

      await expect(page.getByLabel('Specific day')).toBeHidden();
      await expect(page.getByLabel('Job',{exact:true})).toBeHidden();
      await filterSummary().focus();
      await page.keyboard.press('Enter');
      await expect(filterSummary().locator('..')).toHaveJSProperty('open',true);
      await expect(page.getByLabel('Specific day')).toBeVisible();
      await noOverflow();
      await page.getByLabel('Transaction type').selectOption('income');
      await expect(page.locator('article')).toHaveCount(1);
      await expect(monthTotal('Income received')).toContainText('$1,500.25');
      await expect(monthTotal('Expenses & bills')).toContainText('$0.00');
      await page.getByRole('button',{name:'Clear filters'}).click();
      await page.getByLabel('Search', {exact:true}).fill('Review supplier');
      await expect(page.locator('article')).toHaveCount(1);
      await expect(monthTotal('Expenses & bills')).toContainText('$0.00');
      await page.getByRole('button',{name:'Clear filters'}).click();
      await openFilters();
      await page.getByLabel('Specific day').fill('2026-09-17');
      await expect(page.locator('article')).toHaveCount(1);
      await expect(page.locator('article')).toContainText('-$25.15');
      await expect(page.locator('article summary')).toContainText('Expense credit');
      await expect(monthTotal('Expenses & bills')).toContainText('-$25.15');
      await expect(monthTotal('Income less expenses')).toContainText('$25.15');
      await page.getByRole('button',{name:'Clear filters'}).click();
      await openFilters();
      await page.getByLabel('Job',{exact:true}).selectOption('unassigned');
      await expect(page.getByText('No transactions for this selection')).toBeVisible();
      await page.getByRole('button',{name:'+ Add expense',exact:true}).click();
      await expect(page.getByText('Existing bill workflow')).toBeVisible();
      await page.getByRole('button',{name:'+ Record income',exact:true}).click();
      await expect(page.getByText('Existing income workflow')).toBeVisible();

      await page.goto(url+'?stress');
      const largeArticle = page.locator('article').filter({hasText:longVendor});
      await expect(largeArticle.locator('summary')).toContainText(longVendor);
      await expect(largeArticle.locator('summary')).toContainText('$12,345,678.90');
      await noOverflow();
      await largeArticle.locator('summary').click();
      await expect(largeArticle).toContainText('Special-order materials');
      await noOverflow();
      await page.screenshot({path:path.join(dir,`daily-log-stress-${width}.png`),fullPage:true});
    }
    await page.goto(url+'?failed');
    await expect(page.getByRole('alert')).toContainText('couldn’t load');
    await expect(page.getByText('Income received',{exact:true})).toHaveCount(0);
    await page.setViewportSize({width:390,height:844});
    await page.goto(url+'?payment');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('Received date',{exact:true}).fill('2026-09-16');
    await page.getByLabel('Check / reference number',{exact:true}).fill('CHECK-500');
    await page.getByLabel('Description',{exact:true}).fill('Corrected progress payment');
    await page.getByRole('button',{name:'Save & confirm payment'}).click();
    await expect(page.getByRole('status')).toContainText('Payment saved');
    assert.equal(await page.evaluate(()=>window.savedPayment.receivedDate),'2026-09-16');
    assert.equal(await page.evaluate(()=>window.savedPayment.referenceNumber),'CHECK-500');
    assert.equal(await page.evaluate(()=>window.refreshed),true);
    await page.screenshot({path:path.join(dir,'payment-workspace-390.png'),fullPage:true});
    await page.getByRole('button',{name:'Close',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.closedUrl),'/finances/daily-log?month=2026-09');
    assert.deepEqual(errors,[]);
    console.log('PASS: 320/390/1280px overflow, keyboard transaction expansion, collapsed actions and filters, unchanged credits/review totals, long-name/large-amount layout, empty/error states and capture entry points. Screenshots: .finance-preview/');
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
}
