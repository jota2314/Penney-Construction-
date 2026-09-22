const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const zod = require('zod');
let state;
const original = {id:'invoice-4',project_id:'parziale',invoice_number:4,status:'draft',updated_at:'2026-09-21T10:00:00Z',amount:21277.48,paid_at:null,paid_amount:null,quickbooks_invoice_id:null,sent_to_client_at:null,description:'Existing credits and paid invoices',approval_token:'unchanged-token'};
const client = {
 auth:{getUser:async()=>({data:{user:state.signedIn?{id:'jorge'}:null}})},
 from(table) {
  let patch, filters=[];
  const q = {
   select(){return q},update(p){patch=p;return q},
   eq(k,v){filters.push(r=>r[k]===v);return q},
   is(k,v){filters.push(r=>r[k]===v);return q},
   or(){filters.push(r=>r.paid_amount==null||r.paid_amount===0);return q},
   async single(){return {data:{role:state.role}}},
   async maybeSingle(){
    state.updateAttempts++;
    if(!filters.every(f=>f(state.invoice)))return {data:null,error:null};
    Object.assign(state.invoice,patch);return {data:{id:state.invoice.id,amount:state.invoice.amount},error:null};
   },
   then(resolve){resolve({count:state.receipts,error:state.receiptError})},
  };return q;
 }
};
const exportsObj={};
const code=ts.transpileModule(fs.readFileSync('src/lib/actions/invoices.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{exports:exportsObj,require:(id)=>id==='zod'?zod:id==='@/lib/supabase/server'?{createClient:async()=>client}:id==='next/cache'?{revalidatePath:()=>{}}:{},Date,console});
const input={title:'Final invoice - Parziale Renovation',terms:'Due within 5 days of invoice',line_items:[{description:'Original remaining balance',amount:21277.48},{description:'Approved electrical CO #10, no markup',amount:715}]};
function reset(){state={signedIn:true,role:'precon_manager',receipts:0,receiptError:null,invoice:{...original},updateAttempts:0}}
async function run(patch={},payload=input,stamp=original.updated_at){reset();Object.assign(state,patch);return exportsObj.updateClientInvoice('invoice-4','parziale',stamp,payload)}
(async()=>{
 let result=await run();assert.equal(result.data.amount,21992.48);assert.equal(state.invoice.invoice_number,4);assert.equal(state.invoice.approval_token,original.approval_token);assert.equal(state.invoice.description,original.description);assert.equal(state.invoice.status,'draft');
 for(const key of ['paid','sent','void']){result=await run({invoice:{...original,status:key}});assert.ok(result.error);assert.equal(state.invoice.amount,21277.48)}
 for(const patch of [{role:'field'},{signedIn:false},{receipts:1},{receiptError:{message:'lookup failed'}}]){result=await run(patch);assert.ok(result.error);assert.equal(state.updateAttempts,0)}
 for(const patch of [{paid_amount:1},{paid_at:'today'},{quickbooks_invoice_id:'qb-1'},{sent_to_client_at:'today'},{project_id:'another-job'}]){result=await run({invoice:{...original,...patch}});assert.ok(result.error);assert.equal(state.invoice.amount,21277.48)}
 result=await run({},input,'stale');assert.ok(result.error);
 result=await run({}, {...input,line_items:[{description:'invalid',amount:NaN}]});assert.ok(result.error);assert.equal(state.updateAttempts,0);
 result=await run({}, {...input,line_items:[{description:'credit',amount:-1}]});assert.ok(result.error);
 result=await run({}, {...input,line_items:[{description:'Contract',amount:115277.48},{description:'Payments',amount:-94000},{description:'CO 10',amount:715}]});assert.equal(result.data.amount,21992.48);
 console.log('PASS: in-place update, identity/history preservation, credits, rounding, stale save, project scope, authentication, role, paid/sent/void/QB and receipt guards.');
})().catch(e=>{console.error(e);process.exit(1)});
