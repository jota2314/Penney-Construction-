import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const compile = path => ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const grouping = compile('src/lib/finance/review-invoice-groups.ts');
const exports = {};
new Function('exports', grouping)(exports);
const { groupReviewInvoices, pendingReviewAllocations } = exports;
const raw = [60, 480, 480, 1320].map((amount, i) => ({
  id: `id${i}`, split_group_id: 'group', review_pending: true,
  vendor_name: 'AMRemodeling', amount, invoice_number: '068', invoice_date: '2026-08-13',
  project_id: `job${i}`, project_label: ['Dresser', 'Pedersen', 'Caraglia', 'Gallegos'][i],
  line_item_id: i === 1 ? 'line' : null, budget_lines: [{id:'line',description:'Demolition'}],
  photo_url: 'https://example.com/invoice.pdf', has_receipt: true, payment_method: 'check',
  review_reason: 'Job allocation requires reconciliation.',
}));
test('one invoice, unchanged cents, explicit groups only, and reviewed siblings stay in total', () => {
  const [invoice] = groupReviewInvoices(raw);
  assert.equal(invoice.amount, 2340);
  assert.equal(invoice.allocations.length, 4);
  assert.equal(groupReviewInvoices(raw.map(r => ({...r,split_group_id:null}))).length, 4);
  const [partlyReviewed] = groupReviewInvoices(raw.map((r,i) => ({...r,review_pending:i!==1})));
  assert.equal(partlyReviewed.amount,2340);
  assert.deepEqual(pendingReviewAllocations(partlyReviewed).map(r => r.id), ['id0','id2','id3']);
  assert.equal(groupReviewInvoices(raw.map(r => ({...r,review_pending:false}))).length,0);
  assert.equal(groupReviewInvoices(raw.map((r,i)=>({...r,amount:i===0?null:r.amount})))[0].amount,null);
});
const packageFile = (name, file) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), file), 'utf8');
const modules = {
  react: packageFile('react', 'cjs/react.production.js'),
  'react/jsx-runtime': packageFile('react', 'cjs/react-jsx-runtime.production.js'),
  'react-dom': packageFile('react-dom', 'cjs/react-dom.production.js'),
  'react-dom/client': packageFile('react-dom', 'cjs/react-dom-client.production.js'),
  scheduler: packageFile('scheduler', 'cjs/scheduler.production.js'),
  'next/navigation': 'exports.useRouter=()=>({refresh(){}});',
  'next/link': 'exports.default=({children,...props})=>require("react").createElement("a",props,children);',
  'lucide-react': 'exports.FileText=()=>null;',
  '@/components/ui/pdf-viewer': 'exports.PdfViewer=()=>require("react").createElement("div",{role:"dialog"},"Invoice PDF");',
  '@/lib/attachments': 'exports.isPdfAttachment=url=>url.endsWith(".pdf");',
  '@/lib/bills/scan-client': '', '@/lib/receipts/save-upload': '',
  '@/lib/actions/field-capture': 'exports.listBudgetLinesForJob=async()=>[{id:"line",description:"Demolition"}]; exports.resolveCapture=async input=>{window.confirmations.push(input);return {}};',
  '@/components/finances/budget-line-search-select': 'exports.BudgetLineSearchSelect=()=>null;',
  '@/components/finances/job-search-select': 'exports.JobSearchSelect=()=>null;',
  '@/lib/finance/review-invoice-groups': grouping,
  component: compile('src/components/finances/spend-organizer.tsx'),
};
test('mobile review shows one invoice and one PDF, expands existing allocations, confirms only chosen piece', async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    page.on('pageerror', error => console.error(error.message));
    await page.setContent('<div id="root"></div>');
    await page.evaluate(() => {window.confirmations=[];});
    const bundle = `const process={env:{NODE_ENV:'production'}};const modules={${Object.entries(modules).map(([key,code])=>`${JSON.stringify(key)}:function(module,exports,require){${code}\n}`).join(',')}};const cache={};function require(id){if(!cache[id]){const m=cache[id]={exports:{}};modules[id](m,m.exports,require);}return cache[id].exports;}require('react-dom/client').createRoot(document.getElementById('root')).render(require('react').createElement(require('component').SpendOrganizer,{rows:${JSON.stringify(groupReviewInvoices(raw))},jobs:[]}));`;
    await page.addScriptTag({content:bundle});
    const card = page.getByRole('article', {name:'AMRemodeling invoice'});
    await card.waitFor();
    assert.equal(await page.getByRole('article').count(),1);
    assert.match(await card.innerText(), /\$2,340.00/);
    assert.equal(await card.getByText('Job allocation requires reconciliation.',{exact:true}).count(),1);
    assert.equal(await card.getByRole('button',{name:'View invoice PDF'}).count(),1);
    await card.getByRole('button',{name:'Review job allocations (4)'}).click();
    const confirms = card.getByRole('button',{name:'Confirm',exact:true});
    assert.equal(await confirms.count(),4);
    assert.equal(await confirms.nth(0).isDisabled(),true);
    await confirms.nth(1).click();
    assert.equal(await page.evaluate(()=>window.confirmations[0].invoiceId),'id1');
    assert.equal(await card.getByRole('button',{name:'Replace receipt'}).count(),0);
    assert.equal(await card.getByRole('button',{name:'Discard',exact:true}).count(),0);
    await card.getByRole('button',{name:'View invoice PDF'}).click();
    await page.getByRole('dialog').waitFor();
  } finally {await browser.close();}
});
