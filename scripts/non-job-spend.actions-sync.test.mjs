import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function moduleFor(path, imports, extra = '') {
  const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url),'utf8') + extra, {
    compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  const exports={};
  vm.runInNewContext(code, {exports,require:name=>{
    if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
    return imports[name];
  },console,Date,Map,Set,Error});
  return exports;
}
function actionFixture(role='owner', rpcError=null) {
  const calls=[], refreshed=[];
  const api=moduleFor('../src/lib/actions/non-job-spend.ts',{
    'next/cache':{revalidatePath:path=>refreshed.push(path)},
    '@/lib/auth/get-user':{getUser:async()=>role?{profile:{role}}:null},
    '@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{calls.push({name,args});return {error:rpcError};}})},
  });
  return {api,calls,refreshed};
}
const input={invoiceId:'invoice',reason:'owner_draw',note:' Verified statement ',expectedUpdatedAt:'2026-11-05T18:00:00.123456Z'};

test('native action passes exact stale guard and reason, refreshes detail and expenses, has no external send dependency',async()=>{
  const f=actionFixture();
  assert.equal((await f.api.resolveNonJobTransaction(input)).error,undefined);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'resolve_non_job_transaction');
  assert.equal(f.calls[0].args.p_expected_updated_at,input.expectedUpdatedAt);
  assert.equal(f.calls[0].args.p_reason,'owner_draw');assert.equal(f.calls[0].args.p_note,'Verified statement');
  assert.ok(f.refreshed.includes('/spent/invoice'));assert.ok(f.refreshed.includes('/spent/review'));
  assert.ok(f.refreshed.includes('/finances'));
});
test('office-only actions reject anonymous, crew, missing reason/version and reopen explanation before database mutation',async()=>{
  for(const role of [null,'field_worker']) {
    const f=actionFixture(role);assert.match((await f.api.resolveNonJobTransaction(input)).error,/Office access/);assert.equal(f.calls.length,0);
  }
  const f=actionFixture();
  assert.match((await f.api.resolveNonJobTransaction({...input,reason:''})).error,/Choose/);
  assert.match((await f.api.resolveNonJobTransaction({...input,expectedUpdatedAt:''})).error,/Refresh/);
  assert.match((await f.api.reopenNonJobTransaction({...input,note:' '})).error,/Explain why/);
  assert.equal(f.calls.length,0);
});
test('database errors stay visible without refresh; reopen calls only audited native RPC',async()=>{
  const failed=actionFixture('office_admin',{message:'Transaction changed. Refresh and review it again'});
  assert.match((await failed.api.resolveNonJobTransaction(input)).error,/changed/);assert.equal(failed.refreshed.length,0);
  const f=actionFixture('precon_manager');
  assert.equal((await f.api.reopenNonJobTransaction({...input,note:' Correct job cost '})).error,undefined);
  assert.equal(f.calls[0].name,'reopen_non_job_transaction');assert.equal(f.calls[0].args.p_note,'Correct job cost');
  assert.equal(f.calls[0].args.p_expected_updated_at,input.expectedUpdatedAt);
});

function invoiceDb(existing, updateError = () => null) {
  const calls=[];
  const db={from(table){
    const query={table,filters:[],kind:'select'};calls.push(query);
    const chain={
      select(columns){query.columns=columns;return chain;},
      eq(...args){query.filters.push(['eq',...args]);return chain;},
      is(...args){query.filters.push(['is',...args]);return chain;},
      in(...args){query.filters.push(['in',...args]);return chain;},
      update(value){query.kind='update';query.value=value;return chain;},
      insert(value){query.kind='insert';query.value=value;return chain;},
      maybeSingle:async()=>({data:existing,error:null}),
      then(resolve){return Promise.resolve({data:Array.isArray(existing)?existing:[existing].filter(Boolean),error:query.kind==='update'?updateError(query):null}).then(resolve);},
    };return chain;
  }};
  return {db,calls};
}
const sync=moduleFor('../src/lib/quickbooks/sync.ts',{
  '@/lib/supabase/server':{},'@/lib/supabase/admin':{},'./auth':{},'./client':{},
  '@/lib/subs/resolve-subcontractor':{resolveSubcontractorId:async()=>null},
},'\nexport {syncBill, syncPurchase};');

test('repeat Bill and Purchase sync skips classified records even when QB supplies new amount or job',async()=>{
  for(const method of ['syncBill','syncPurchase']) for(const reason of ['owner_draw','card_payment_transfer']) {
    const f=invoiceDb({id:'existing',source:'quickbooks',non_job_reason:reason});
    const result=await sync[method](f.db,{Id:'1',Balance:500,TotalAmt:900,TxnDate:'2026-11-05'},'wrong-job');
    assert.equal(result,false);assert.equal(f.calls.filter(c=>c.kind!=='select').length,0);
    assert.match(f.calls[0].columns,/non_job_reason/);
  }
});
test('ordinary imported records still refresh but conditional update cannot overwrite a concurrent classification',async()=>{
  for(const method of ['syncBill','syncPurchase']) {
    const f=invoiceDb({id:'existing',source:'quickbooks',non_job_reason:null});
    await sync[method](f.db,{Id:'1',Balance:500,TotalAmt:900,TxnDate:'2026-11-05',Line:[]},'job');
    const mutation=f.calls.find(c=>c.kind==='update');assert.ok(mutation);
    assert.equal(mutation.value.amount,900);
    assert.ok(mutation.filters.some(([op,column,value])=>op==='is'&&column==='non_job_reason'&&value===null));
  }
});
test('stale direct outgoing expense/bill request skips non-job rows without erasing existing error or calling QBO',async()=>{
  for(const method of ['pushVendorExpenseToQuickBooks','pushVendorBillToQuickBooks']) {
    const f=invoiceDb([{id:'existing',source:'field_capture',non_job_reason:'owner_draw',quickbooks_push_error:'Original source error'}]);
    let externalCalls=0;
    const api=moduleFor('../src/lib/quickbooks/expenses.ts',{
      '@/lib/supabase/admin':{createAdminClient:()=>f.db},
      '@/lib/finance/spend-category':{},'@/lib/finance/bank-sources':{isBankLedgerSource:()=>false},
      './auth':{isQuickBooksConnected:async()=>true,getValidAccessToken:async()=>{externalCalls++;throw new Error('Must not call QBO');}},
      './client':{qbQuery:async()=>{externalCalls++;},qbPost:async()=>{externalCalls++;}},
      './customers':{},'./vendor-match':{},
    });
    assert.equal((await api[method](['existing'])).error,null);
    assert.equal(externalCalls,0);assert.equal(f.calls.filter(c=>c.kind!=='select').length,0);
  }
});

function pushClaimFixture({claimError=null,releaseError=null}={}) {
  const f=invoiceDb([{id:'ordinary',source:'field_capture',non_job_reason:null},
    {id:'excluded',source:'field_capture',non_job_reason:'owner_draw'}]);
  const events=[];
  f.db.rpc=async(name,args)=>{
    events.push({name,args});
    return name==='claim_invoice_quickbooks_push'?{data:claimError?null:'durable-token',error:claimError?{message:claimError}:null}:
      {data:null,error:releaseError?{message:releaseError}:null};
  };
  let externalCalls=0;
  const api=moduleFor('../src/lib/quickbooks/expenses.ts',{
    '@/lib/supabase/admin':{createAdminClient:()=>f.db},
    '@/lib/finance/spend-category':{},'@/lib/finance/bank-sources':{isBankLedgerSource:()=>false},
    './auth':{isQuickBooksConnected:async()=>{externalCalls++;return true;}},
    './client':{},'./customers':{},'./vendor-match':{},
  },'\nexport {withInvoiceQuickBooksPushClaim};');
  return {api,events,get externalCalls(){return externalCalls;}};
}

test('outbound lifecycle claims only eligible IDs, keeps claim through local stamping, then releases exact token',async()=>{
  const f=pushClaimFixture();
  const result=await f.api.withInvoiceQuickBooksPushClaim(['ordinary','excluded'],async (ids,markUncertain)=>{
    assert.deepEqual(Array.from(ids),['ordinary']);
    assert.equal(f.events.length,1); assert.equal(f.events[0].name,'claim_invoice_quickbooks_push');
    markUncertain();f.events.push({name:'remote-write'});await Promise.resolve();
    f.events.push({name:'local-link-stamp'});return {error:null,qbPurchaseId:'kept-link'};
  });
  assert.equal(result.qbPurchaseId,'kept-link');
  assert.deepEqual(f.events.map(e=>e.name),['claim_invoice_quickbooks_push','remote-write','local-link-stamp','release_invoice_quickbooks_push']);
  assert.equal(f.events[3].args.p_claim_token,'durable-token');
});

test('both outbound entry points refuse a raced classification or existing claim before any remote operation',async()=>{
  for(const method of ['pushVendorExpenseToQuickBooks','pushVendorBillToQuickBooks']) {
    for(const message of ['Transaction was resolved as non-job','A QuickBooks send is active or awaiting reconciliation']) {
      const f=pushClaimFixture({claimError:message});
      assert.equal((await f.api[method](['ordinary'])).error,message);
      assert.equal(f.externalCalls,0);assert.equal(f.events.length,1);
    }
  }
});

test('known pre-send failure releases; unknown remote/stamp failures retain claim; failed release surfaces reconciliation',async()=>{
  const f=pushClaimFixture();
  const result=await f.api.withInvoiceQuickBooksPushClaim(['ordinary'],async()=>{throw new Error('Push failed');});
  assert.equal(result.error,'Push failed');assert.equal(f.events.at(-1).name,'release_invoice_quickbooks_push');
  for(const mode of ['throw','returned-error']) {
    const uncertain=pushClaimFixture();
    const pending=await uncertain.api.withInvoiceQuickBooksPushClaim(['ordinary'],async(_ids,markUncertain)=>{
      markUncertain();
      if(mode==='throw') throw new Error('Timeout after send');
      return {error:'Local QuickBooks ID stamp failed'};
    });
    assert.match(pending.error,/reconciliation/);
    assert.equal(uncertain.events.length,1);assert.equal(uncertain.events[0].name,'claim_invoice_quickbooks_push');
  }
  const failed=pushClaimFixture({releaseError:'database unavailable'});
  assert.match((await failed.api.withInvoiceQuickBooksPushClaim(['ordinary'],async()=>({error:null}))).error,/reconciliation/);
  assert.equal(failed.events.filter(e=>e.name==='claim_invoice_quickbooks_push').length,1);
  assert.equal(failed.events.at(-1).args.p_claim_token,'durable-token');
});

test('real Purchase, Bill, VendorCredit and BillPayment paths retain claims on timeout/missing ID/link failure and release on verified completion',async()=>{
  for(const entity of ['Purchase','Bill','VendorCredit','BillPayment']) for(const mode of ['timeout','missing-id','stamp-failure','success']) {
    const payment=entity==='BillPayment';
    const record={id:'ordinary',source:'field_capture',non_job_reason:null,vendor_name:'Vendor',amount:entity==='VendorCredit'?-100:100,
      payment_status:entity==='Purchase'||payment?'paid':'unpaid',payment_method:'check',invoice_date:null,invoice_number:null,
      quickbooks_bill_id:payment?'existing-bill':null,quickbooks_id:payment?'qb_bill_existing-bill':null,
      projects:{id:'overhead',is_overhead:true},created_by:null};
    const f=invoiceDb([record],query=>mode==='stamp-failure'&&(query.value.quickbooks_purchase_id||query.value.quickbooks_bill_id)?{message:'Local stamp unavailable'}:null);
    const events=[];
    f.db.rpc=async(name,args)=>{events.push({name,args});return {data:name==='claim_invoice_quickbooks_push'?'token':null,error:null};};
    const api=moduleFor('../src/lib/quickbooks/expenses.ts',{
      '@/lib/supabase/admin':{createAdminClient:()=>f.db},
      '@/lib/finance/spend-category':{accountNameFor:()=> 'Expense'},
      '@/lib/finance/bank-sources':{isBankLedgerSource:()=>false},
      './auth':{isQuickBooksConnected:async()=>true,getValidAccessToken:async()=>({accessToken:'test',realmId:'test',environment:'sandbox'})},
      './client':{
        qbQuery:async(_realm,_token,query)=>query.includes('FROM Account')?[{Id:'bank',Name:'Bank',FullyQualifiedName:'Bank',AccountType:'Bank'},
          {Id:'expense',Name:'Expense',FullyQualifiedName:'Expense',AccountType:'Expense'}]:
          query.includes('FROM Vendor')?[{Id:'vendor',DisplayName:'Vendor'}]:query.includes('FROM Bill')?[{Id:'existing-bill',Balance:100,TotalAmt:100}]:[],
        qbPost:async(_realm,_token,kind)=>{events.push({name:'qbPost',entity:kind});if(mode==='timeout')throw new Error('Timeout after remote acceptance');return mode==='missing-id'?{}:{Id:'posted-id'};},
      },
      './customers':{},'./vendor-match':{normalizeVendorName:name=>name.toLowerCase(),matchVendor:()=>({vendor:{Id:'vendor',DisplayName:'Vendor'}})},
    });
    const result=await api[entity==='Purchase'||payment?'pushVendorExpenseToQuickBooks':'pushVendorBillToQuickBooks'](['ordinary']);
    assert.equal(events.find(e=>e.name==='qbPost')?.entity,entity,`${entity}/${mode} reaches the financial post`);
    if(mode==='success') {
      assert.equal(result.error,null,`${entity}/${mode}`);
      assert.equal(events.at(-1).name,'release_invoice_quickbooks_push');
    } else {
      assert.match(result.error,/reconciliation/,`${entity}/${mode}`);
      assert.ok(!events.some(e=>e.name==='release_invoice_quickbooks_push'),`${entity}/${mode} retains claim`);
    }
  }
});
