import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReceipt, strictReceiptSchema } from '../src/lib/ai/receipt-analysis.ts';
import { splitAnalysisSchema, validateSplitAmounts } from '../src/lib/finance/split-suggestions.ts';
const valid = {explanation:'Returned material',warnings:[],pieces:[{project_id:null,line_item_id:null,amount:-84.92,note:'Returned boards'}]};
const response = value => Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});
function options(extra={}) { return {apiKey:'test-only',requestId:'test',content:[{type:'document',source:{type:'base64',media_type:'application/pdf',data:'JVBERi0='}}],schema:{type:'object',properties:{}},validate: v => {const p=splitAnalysisSchema.parse(v);validateSplitAmounts(-84.92,p.pieces);return p;},signal:new AbortController().signal,deadline:Date.now()+1000, getClaude:async()=>{throw Error('must not use backup');},...extra}; }
test('OpenAI reads PDFs, requests strict JSON, disables storage, accepts credits',async()=>{
 const result=await analyzeReceipt(options({deadline:Date.now()+10000,fetcher:async(url,init)=>{
   assert.equal(url,'https://api.openai.com/v1/responses'); const b=JSON.parse(init.body);
   assert.equal(b.store,false);assert.equal(b.text.format.strict,true);
   assert.equal(b.input[0].content[0].file_data,'data:application/pdf;base64,JVBERi0=');
   return response(valid);
 }}));assert.deepEqual(result,valid);
});
test('provider errors, malformed JSON, and invalid amounts trigger OpenAI backup',async()=>{
 for(const first of [()=>Response.json({error:{code:'rate_limit'}},{status:429}),()=>Response.json({status:'completed',output:[]}),()=>response({...valid,pieces:[{...valid.pieces[0],amount:84.92}]})]){
  let calls=0;const result=await analyzeReceipt(options({deadline:Date.now()+10000,fetcher:async(url,init)=>{calls++;if(calls===1)return first();assert.equal(JSON.parse(init.body).model,'gpt-4.1-mini');return response(valid);}}));
  assert.equal(calls,2);assert.deepEqual(result,valid);
 }
});
test('abort never retries, exhausted deadline never calls either provider',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(analyzeReceipt(options({signal:controller.signal,fetcher:async()=>{calls++;return response(valid);}})));
 await assert.rejects(analyzeReceipt(options({deadline:Date.now()-1,fetcher:async()=>{calls++;return response(valid);}})),/timed out/);
 assert.equal(calls,0);
});
test('all provider failures surface a useful reference without raw provider text',async()=>{
 await assert.rejects(analyzeReceipt(options({deadline:Date.now()+10000,fetcher:async()=>{throw Error('secret provider payload');}})),e=>e.code==='provider_error'&&e.message.includes('Reference: test')&&!e.message.includes('secret'));
});
test('structured schema makes optional nullable fields required recursively',()=>{
 const s=strictReceiptSchema({type:'object',properties:{pieces:{type:'array',items:{type:'object',properties:{line_item_id:{type:['string','null']}}}}}});
 assert.deepEqual(s.required,['pieces']);assert.deepEqual(s.properties.pieces.items.required,['line_item_id']);assert.equal(s.properties.pieces.items.additionalProperties,false);
});
