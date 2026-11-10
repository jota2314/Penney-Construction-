// Real API/service/UI code, isolated transports. Never connects to a database or sends email.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const deps = createRequire(require("node:path").resolve("../penney-mcp/package.json"));
const ts = deps("typescript");
const { z } = deps("zod");
const project = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const coId = "00000000-0000-4000-8000-000000000003";
const lineId = "00000000-0000-4000-8000-000000000004";
const requestId = "00000000-0000-4000-8000-000000000005";
function load(source, imports, globals={}) {
  const exports={};
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(compiled,{exports,require(id){if(!(id in imports))throw new Error(`Unexpected import ${id}`);return imports[id];},Buffer,Date,Error,console,...globals});
  return exports;
}
const read=path=>fs.readFileSync(path,"utf8");
const financials=load(read("src/lib/estimates/line-item-financials.ts"),{});
const service=load(read("src/lib/change-orders/service.ts"),{
  "@/lib/estimates/line-item-financials":financials,
  "@/lib/google/gmail":{},"@/lib/google/server-auth":{},"./email":{},
});
function harness() {
  const state={rpc:[],rpcError:null,key:"test-only-service-key",profile:{id:actor,full_name:"Office",email:"office@example.test",role:"owner"},user:null};
  const admin={
    async rpc(name,args){state.rpc.push({name,args});return {data:{applied:args.p_apply},error:state.rpcError};},
    from(table){return {select(){return this;},eq(){return this;},async single(){return {data:{value:state.key},error:null};},async maybeSingle(){assert.equal(table,"profiles");return {data:state.profile,error:null};}};},
  };
  class Response {constructor(body,status){this.body=body;this.status=status;} static json(body,options={}){return new Response(body,options.status??200);}}
  const route=load(read("src/app/api/change-orders/route.ts"),{
    "next/server":{NextResponse:Response},"node:crypto":require("node:crypto"),zod:{z},
    "@/lib/supabase/admin":{createAdminClient:()=>admin},"@/lib/auth/get-user":{getUser:async()=>state.user},
    "@/lib/change-orders/service":service,
  });
  const call=(body,headers={"x-service-key":state.key,"x-penney-actor":actor})=>route.POST({headers:new Headers(headers),json:async()=>body});
  return {state,call};
}
const preview={action:"preview_budget_sync",project_id:project,change_order_id:coId,line_id:lineId};
const apply={...preview,action:"reconcile_budget",request_id:requestId,expected_change_order_fingerprint:"a".repeat(32),expected_line_fingerprint:"b".repeat(32),reason:"Verified the signed CO PDF and project evidence.",evidence_refs:["project-files:signed.pdf#sha256=fixture"],authorized:true};

test("native preview and authorized apply pass the verified actor and exact IDs to the transaction",async()=>{
  const {state,call}=harness();
  assert.equal((await call(preview)).status,200);
  assert.equal(state.rpc[0].args.p_apply,false);
  assert.equal(state.rpc[0].args.p_actor_id,actor);
  assert.equal(state.rpc[0].args.p_line_id,lineId);
  assert.equal((await call(apply)).status,200);
  assert.equal(state.rpc[1].args.p_apply,true);
  assert.equal(state.rpc[1].args.p_request_id,requestId);
  assert.equal(state.rpc[1].args.p_expected_line_fingerprint,apply.expected_line_fingerprint);
});

test("apply rejects missing authorization, spoofed actors, missing versions, supplied price and absent evidence",async()=>{
  const {state,call}=harness();
  for(const value of [{...apply,authorized:undefined},{...apply,authorized:false},{...apply,actor_id:actor},{...apply,expected_line_fingerprint:undefined},{...apply,price_impact:999},{...apply,evidence_refs:[]}]){
    assert.equal((await call(value)).status,400);
  }
  assert.equal(state.rpc.length,0);
});

test("service-key, field-user, view-as and database office checks are enforced",async()=>{
  const {state,call}=harness();
  assert.equal((await call(preview,{"x-service-key":"wrong","x-penney-actor":actor})).status,401);
  state.profile.role="field";assert.equal((await call(preview)).status,403);
  state.user={profile:{role:"owner"},isImpersonating:true};assert.equal((await call(preview,{})).status,403);
  assert.equal(state.rpc.length,0);
  state.profile.role="project_manager";state.rpcError={code:"42501",message:"Office review access required"};
  assert.equal((await call(preview)).status,403);
});

test("a stale preview returns conflict, never success",async()=>{
  const {state,call}=harness();state.rpcError={code:"40001",message:"The CO or budget line changed after preview"};
  const result=await call(apply);assert.equal(result.status,409);assert.match(result.body.error,/changed after preview/);
});

function editDb(coPatch={},signDuringUpdate=false) {
  const state={co:{id:coId,title:"Sonotubes",status:"draft",cost_impact:300,price_impact:450,client_signed_at:null,client_signature:null,updated_at:"2026-11-10T12:00:00Z",...coPatch},filters:[],lineWrites:[],coWrites:[]};
  const db={from(table){const q={update:null};return {
    select(){return this;},eq(k,v){if(q.update)state.filters.push([k,v]);return this;},is(k,v){state.filters.push([k,v]);return this;},
    update(value){q.update=value;(table==="change_orders"?state.coWrites:state.lineWrites).push(value);return this;},
    async maybeSingle(){if(q.update)return {data:signDuringUpdate?null:{...state.co,...q.update},error:null};return {data:state.co,error:null};},
    then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);},
  };}};
  return {db,state};
}
test("native draft edit keeps both financial column sets in sync",async()=>{
  const {db,state}=editDb();
  await service.updateChangeOrderDraft(db,{change_order_id:coId,cost_impact:757.60,price_impact:1000},"https://example.test");
  assert.equal(state.lineWrites.length,1);
  const line=state.lineWrites[0];assert.equal(line.client_price,1000);assert.equal(line.total_price,1000);assert.equal(line.cost,757.60);assert.equal(line.total_cost,757.60);
});
test("signed edits and signing during an edit do not change the tracking budget",async()=>{
  let h=editDb({client_signed_at:"2026-11-10T12:01:00Z"});
  await assert.rejects(()=>service.updateChangeOrderDraft(h.db,{change_order_id:coId,price_impact:1000},"https://example.test"),/signed or approved/);
  assert.equal(h.state.coWrites.length,0);assert.equal(h.state.lineWrites.length,0);
  h=editDb({},true);
  await assert.rejects(()=>service.updateChangeOrderDraft(h.db,{change_order_id:coId,price_impact:1000},"https://example.test"),/changed or was signed/);
  assert.equal(h.state.lineWrites.length,0);
  assert.ok(h.state.filters.some(([k,v])=>k==="updated_at"&&v===h.state.co.updated_at));
  assert.ok(h.state.filters.some(([k,v])=>k==="client_signed_at"&&v===null));
  assert.ok(h.state.filters.some(([k,v])=>k==="client_signature"&&v===null));
  assert.ok(h.state.filters.some(([k,v])=>k==="status"&&v==="draft"));
});

test("Finances edit uses native workflow and shows failed budget synchronization",async()=>{
  const source=read("src/components/projects/project-finances-tab.tsx");
  const snippet=source.slice(source.indexOf("function EditCOButton("),source.indexOf("function DeleteCOButton("));
  const states=[];let index=0;const calls=[];let refreshes=0;
  const jsx=(type,props)=>({type,props});
  const component=load("export "+snippet,{"react/jsx-runtime":{jsx,jsxs:jsx,Fragment:"fragment"}},{
    useState(initial){const i=index++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=value;}];},
    useRouter:()=>({refresh(){refreshes++;}}),parseMoney:value=>Number(value),Pencil:"pencil",
    async fetch(url,input){calls.push({url,body:JSON.parse(input.body)});return {ok:true,json:async()=>({warning:"Budget line could not update"})};},
  }).EditCOButton;
  const co={id:coId,change_order_number:9,title:"Sonotubes",description:"Scope",status:"draft",cost_impact:300,price_impact:450};
  const render=()=>{index=0;return component({co});};
  const nodes=node=>!node||typeof node!=="object"?[]:[node,...[node.props?.children].flat(2).flatMap(nodes)];
  let tree=render();nodes(tree).find(n=>n.type==="button").props.onClick();tree=render();
  await nodes(tree).find(n=>n.type==="button"&&n.props.children==="Save Changes").props.onClick();
  assert.equal(calls[0].url,"/api/change-orders");assert.equal(calls[0].body.action,"update");assert.equal(calls[0].body.change_order_id,coId);
  tree=render();assert.equal(nodes(tree).find(n=>n.props?.role==="alert").props.children,"Budget line could not update");assert.equal(refreshes,0);
  co.status="approved";tree=render();assert.equal(nodes(tree).find(n=>n.type==="button").props.disabled,true);
});
