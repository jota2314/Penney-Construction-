import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const compile = path => ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const packageFile = (name, file) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), file), 'utf8');
const modules = {
  react: packageFile('react', 'cjs/react.production.js'),
  'react/jsx-runtime': packageFile('react', 'cjs/react-jsx-runtime.production.js'),
  'react-dom': packageFile('react-dom', 'cjs/react-dom.production.js'),
  'react-dom/client': packageFile('react-dom', 'cjs/react-dom-client.production.js'),
  scheduler: packageFile('scheduler', 'cjs/scheduler.production.js'),
  '@/components/field-feed/tokens': 'exports.v = () => "#888";',
  '@/lib/image/compress': 'exports.compressImage = async file => file;',
  '@/lib/receipts/save-upload': 'exports.saveReceiptUpload = async () => "user/bill.pdf"; exports.savedUploadError = (_, error) => error;',
  '@/lib/actions/daily-logs': 'exports.searchActiveJobs = async () => [{id:"job2",name:"Other job"}];',
  component: compile('src/components/invoices/bill-drop.tsx'),
};
function makeBundle(modules, component = "BillDrop") { return `const process = {env:{NODE_ENV:'production'}}; const modules = {${Object.entries(modules).map(([key, code]) => `${JSON.stringify(key)}:function(module,exports,require){${code}\n}`).join(',')}}; const cache={}; function require(id){if(!cache[id]){const m=cache[id]={exports:{}};modules[id](m,m.exports,require);}return cache[id].exports;} require('react-dom/client').createRoot(document.getElementById('root')).render(require('react').createElement(require('component')[${JSON.stringify(component)}]));`; }
const scan = {
  status: 'scanned', scan: {storagePath:'user/bill.pdf',documentType:'invoice',vendor:'K.M.K. Roofing',amount:700,invoiceNumber:null,date:'2026-09-06',dueDate:null,trade:'roofing',summary:'Roof vent',extractedText:'SUBTOTAL 700 DEPOSIT 350 BALANCE DUE 350'},
  job:{id:'job',label:'White Kitchen'}, allocations:[{lineItemId:'line',lineLabel:'Roofing',trade:'roofing',amount:700,note:null}], budgetLines:[{id:'line',description:'Roofing',trade:'roofing'}]
};
for (const corrected of ['350', '3.50', '3.23']) test(`mobile correction to ${corrected} persists, rescans keep it, and penny mismatches cannot file`, async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    await page.setContent('<div id="root"></div>');
    await page.evaluate(scan => {
      window.commits=[];
      window.fetch=async (url, options) => {
        if(url.includes('/scan')) return {ok:true,json:async()=>structuredClone(scan)};
        const body=JSON.parse(options.body); window.commits.push(body);
        return {ok:true,json:async()=>({vendor:body.vendor,amount:body.amount,invoiceId:'test',project:'White Kitchen'})};
      };
    }, scan);
    await page.addScriptTag({content:makeBundle(modules)});
    await page.locator('input[type=file]').setInputFiles({name:'invoice.pdf',mimeType:'application/pdf',buffer:Buffer.from('test')});
    const total=page.getByLabel('Invoice total', {exact:true});
    await total.waitFor();
    assert.equal(await total.inputValue(),'700');
    const budget=page.getByLabel('Budget amount for Roofing');
    await budget.fill('350');
    assert.equal(await page.getByRole('button',{name:/Confirm/}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>window.commits.length),0);
    await total.fill(corrected);
    assert.equal(Number(await budget.inputValue()),Number(corrected));
    await budget.fill(String(Number(corrected) - 0.01));
    assert.equal(await page.getByRole('button',{name:/Confirm/}).isDisabled(),true);
    await budget.fill(corrected);
    await page.getByRole('button',{name:/Job.*White Kitchen/}).click();
    await page.getByRole('button',{name:'Other job'}).click();
    await total.waitFor();
    assert.equal(await total.inputValue(),corrected);
    assert.equal(Number(await budget.inputValue()),Number(corrected));
    await page.getByRole('button',{name:/Confirm/}).click();
    await page.waitForFunction(()=>window.commits.length===1);
    const [body]=await page.evaluate(()=>window.commits);
    assert.equal(body.amount,Number(corrected));
    assert.equal(body.allocations[0].amount,Number(corrected));
    assert.match(body.extractedText,/700/); // Stale OCR is retained as source text, never as the filed amount.
  } finally { await browser.close(); }
});

function commitRoute() {
  const inserted=[];
  const db={rpc:async()=>({data:[{id:'child1'},{id:'child2'}],error:null}),from(table){
    let insert=false;
    const q=new Proxy({}, {get(_,prop){
      if(prop==='then') return resolve=>resolve({data:table==='estimate_line_items'?[{id:'line',estimates:{project_id:'job'}},{id:'line2',estimates:{project_id:'job'}}]:[],error:null});
      return (...args)=>{
        if(prop==='insert'){insert=true;inserted.push(args[0]);}
        if(prop==='single'||prop==='maybeSingle') return Promise.resolve({data:insert?{id:'invoice'}:table==='projects'?{id:'job',name:'White Kitchen'}:{full_name:'Tester'},error:null});
        return q;
      };
    }});return q;
  }};
  const mocks={
    'next/server':{NextResponse:{json:(body,opts)=>({status:opts?.status??200,body})}},
    '@/lib/supabase/server':{createClient:async()=>db},
    '@/lib/supabase/admin':{createAdminClient:()=>db},
    '@/lib/auth/get-user':{getUser:async()=>({id:'user'})},
    '@/lib/subs/resolve-subcontractor':{resolveSubcontractorId:async()=>null},
    '@/lib/finance/spend-category':{resolveVendorType:()=> 'subcontractor'},
    '@/lib/finance/quote-detection':{detectQuoteDocument:()=>({isQuote:false})},
    '@/lib/finance/credit-detection':{detectCreditDocument:()=>({isCredit:false})},
    '@/lib/auth/role-access':{canApproveBillPay:()=>false},
    '@/lib/notifications/tagged-mentions':{notifyFieldInvoiceCaptured:async()=>{},notifyBillApprovedForPay:async()=>{}},
    '@/lib/quickbooks/expenses':{pushVendorExpenseToQuickBooks:async()=>{},pushVendorBillToQuickBooks:async()=>{}},
  };
  const module={exports:{}};
  new Function('require','module','exports',compile('src/app/api/bills/commit/route.ts'))(id=>{assert.ok(id in mocks,id);return mocks[id];},module,module.exports);
  return {post:body=>module.exports.POST({json:async()=>body}), inserted};
}
const body={projectId:'job',vendor:'K.M.K. Roofing',amount:350,extractedText:'SUBTOTAL 700 DEPOSIT 350 BALANCE DUE 350',allocations:[{lineItemId:'line',amount:350}]};
test('commit saves the human $350 correction despite stale $700 OCR',async()=>{
  const {post,inserted}=commitRoute(); const response=await post(body);
  assert.equal(response.status,200);assert.equal(response.body.amount,350);
  assert.equal(inserted[0].amount,350);assert.equal(inserted[0].estimate_line_item_id,'line');
});
test('commit rejects $700 total with $350 allocation before any insert',async()=>{
  const {post,inserted}=commitRoute(); const response=await post({...body,amount:700});
  assert.equal(response.status,400);assert.equal(inserted.length,0);
});
test('commit rejects zero or invalid budget rows instead of dropping the correction',async()=>{
  for(const amount of [0,null,'350']){
    const {post,inserted}=commitRoute(); const response=await post({...body,allocations:[{lineItemId:'line',amount}]});
    assert.equal(response.status,400);assert.equal(inserted.length,0);
  }
});
test('credits stay negative and paid bills keep total even with zero balance due',async()=>{
  for(const amount of [-350,350]){
    const {post,inserted}=commitRoute();const response=await post({...body,amount,paid:true,extractedText:'BALANCE DUE 0',allocations:[{lineItemId:'line',amount}]});
    assert.equal(response.status,200);assert.equal(inserted[0].amount,amount);assert.equal(inserted[0].paid_amount,amount);
  }
});

for (const corrected of ['350', '3.50', '3.23']) test(`Add a bill waits for review and files ${corrected}`,  async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    await page.setContent('<div id="root"></div>');
    await page.evaluate(scan => {
      window.commits=[];
      window.fetch=async (url,options) => {
        if(url.includes('/scan')) return {ok:true,json:async()=>structuredClone(scan)};
        const body=JSON.parse(options.body);window.commits.push(body);
        return {ok:true,json:async()=>({...body,invoiceId:'test'})};
      };
    }, scan);
    const dialogModules={...modules,
      component:compile('src/components/invoices/add-bill-dialog.tsx'),
      'next/navigation':'exports.useRouter=()=>({refresh(){}});',
      '@/components/ui/dialog':'const React=require("react"); exports.Dialog=({open,children})=>open?children:null; for(const name of ["DialogContent","DialogHeader","DialogTitle"]) exports[name]=({children})=>React.createElement("div",null,children);',
      '@/components/ui/button':'exports.Button=({children,...props})=>require("react").createElement("button",props,children);',
      'lucide-react':'for(const name of ["Loader2","Plus","Upload","FileText","CheckCircle2"]) exports[name]=()=>null;',
      '@/lib/actions/vendor-bills':'exports.listPayerOptions=async()=>[];',
      '@/lib/actions/field-capture':'exports.listCaptureJobOptions=async()=>[{id:"job",name:"White Kitchen"}]; exports.listBudgetLinesForJob=async()=>[{id:"line",description:"Roofing"}];',
      '@/components/finances/job-search-select':'exports.JobSearchSelect=()=>null;',
    };
    await page.addScriptTag({content:makeBundle(dialogModules,'AddBillDialog')});
    await page.getByRole('button',{name:'Add a bill',exact:true}).click();
    await page.locator('input[type=file]').setInputFiles({name:'invoice.pdf',mimeType:'application/pdf',buffer:Buffer.from('test')});
    const total=page.getByLabel('Invoice total',{exact:true});await total.waitFor();
    assert.equal(await total.inputValue(),'700');
    assert.equal(await page.evaluate(()=>window.commits.length),0);
    await total.fill(corrected);
    await page.getByRole('button',{name:'File it — unpaid',exact:true}).click();
    await page.waitForFunction(()=>window.commits.length===1);
    const [body]=await page.evaluate(()=>window.commits);
    assert.equal(body.amount,Number(corrected));assert.equal(body.allocations[0].amount,Number(corrected));
    assert.equal(body.documentType,'invoice');
  } finally {await browser.close();}
});

test('invoice amounts retain cents, including $3.50 and $3.23',async()=>{
  for(const amount of [3.50,3.23,0.01,0.10,0.29,1.15,1234.56,-3.50,-3.23]) {
    const {post,inserted}=commitRoute();const response=await post({...body,amount,allocations:[{lineItemId:'line',amount}]});
    assert.equal(response.status,200);assert.equal(response.body.amount,amount);assert.equal(inserted[0].amount,amount);
  }
});
test('even a one-cent mismatch is rejected before saving',async()=>{
  for(const [amount,allocated] of [[3.50,3.49],[3.50,3.51],[3.23,3.22],[3.23,3.24],[-3.23,-3.22]]) {
    const {post,inserted}=commitRoute();const response=await post({...body,amount,allocations:[{lineItemId:'line',amount:allocated}]});
    assert.equal(response.status,400,amount+' total vs '+allocated+' assigned');assert.equal(inserted.length,0);
  }
});

test('decimal splits add exactly in cents without floating-point drift',async()=>{
  for(const [amount,first,second] of [[0.30,0.10,0.20],[6.73,3.50,3.23],[0.30,0.29,0.01],[-6.73,-3.50,-3.23]]) {
    const {post,inserted}=commitRoute();const response=await post({...body,amount,allocations:[{lineItemId:'line',amount:first},{lineItemId:'line2',amount:second}]});
    assert.equal(response.status,200);assert.equal(inserted[0].amount,amount);
  }
});
