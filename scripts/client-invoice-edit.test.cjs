const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const zod = require('zod');
let state;
const client = {
 auth:{getUser:async()=>({data:{user:state.signedIn?{id:'jorge'}:null}})},
 from(table) {
  assert.equal(table,'profiles');
  const q={select(){return q},eq(){return q},async single(){return {data:{role:state.role}}}};
  return q;
 },
 async rpc(name,args){state.calls.push({name,args});return state.response;}
};
const exportsObj={};
const code=ts.transpileModule(fs.readFileSync('src/lib/actions/invoices.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{exports:exportsObj,require:(id)=>id==='zod'?zod:id==='@/lib/supabase/server'?{createClient:async()=>client}:id==='next/cache'?{revalidatePath:(path)=>state.invalidations.push(path)}:{},Date,console});
const input={title:'Final invoice',terms:'Due on receipt',line_items:[{description:'Contract balance',amount:5174},{description:'Advance credit',amount:-648.58}]};
async function run(patch={},payload=input,stamp='2026-10-01T00:00:00Z'){
 state={signedIn:true,role:'precon_manager',calls:[],invalidations:[],response:{data:{id:'invoice-4',amount:4525.42},error:null},...patch};
 return exportsObj.updateClientInvoice('invoice-4','test-job',stamp,payload);
}
(async()=>{
 const result=await run();assert.equal(result.data.amount,4525.42);
 assert.equal(state.calls.length,1);assert.equal(state.calls[0].name,'revise_client_invoice');
 const args=state.calls[0].args;
 assert.equal(args.p_invoice_id,'invoice-4');assert.equal(args.p_project_id,'test-job');
 assert.equal(args.p_expected_updated_at,'2026-10-01T00:00:00Z');
 assert.equal(JSON.stringify(args.p_line_items),JSON.stringify(input.line_items));
 assert.deepEqual(state.invalidations,['/projects/test-job']);
 for(const patch of [{signedIn:false},{role:'field'}]){
  assert.ok((await run(patch)).error);assert.equal(state.calls.length,0);
 }
 for(const payload of [{...input,title:''},{...input,line_items:[{description:'invalid',amount:NaN}]}]){
  assert.ok((await run({},payload)).error);assert.equal(state.calls.length,0);
 }
 assert.ok((await run({},input,'')).error);assert.equal(state.calls.length,0);
 const failed=await run({response:{data:null,error:{message:'Invoice changed; refresh before editing'}}});
 assert.equal(failed.error,'Invoice changed; refresh before editing');assert.equal(state.invalidations.length,0);
 console.log('PASS: authenticated shared workflow, exact credit forwarding, project/version scope, validation, error propagation and success-only refresh. Transaction guards are tested by the MCP isolated Postgres suite.');
})().catch(e=>{console.error(e);process.exit(1)});
