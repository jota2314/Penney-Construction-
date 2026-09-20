/* eslint-disable @typescript-eslint/no-require-imports -- Isolated server-action regression. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
let role = 'owner', authenticated = true, updated = {id:'payment'}, writes = [], filters = [], invalidated = [];
const query = {
  select(){return this}, order(){return this}, limit(){return this},
  eq(column,value){ filters.push([column,value]); return this; },
  update(value){writes.push(value);return this},
  maybeSingle: async()=>({data:updated,error:null}),
  then(resolve){return Promise.resolve({data:[],error:null}).then(resolve)},
};
const db={from:()=>query,auth:{getUser:async()=>({data:{user:authenticated?{id:'user'}:null}})}};
const mocked = {
  'next/cache': {revalidatePath:path=>invalidated.push(path)},
  '@/lib/supabase/server': {createClient:async()=>db},
  '@/lib/auth/require-auth': {requireAuth:async()=>({profile:{role}})},
  '@/lib/auth/role-access': {canSeeBoardMoney:role=>role==='owner'},
};
const moduleObject={exports:{}};
const code=ts.transpileModule(fs.readFileSync('src/lib/actions/deposit-capture.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
vm.runInNewContext(code,{exports:moduleObject.exports,require:name=>{if(!mocked[name]) throw Error(name);return mocked[name]},Date,Number,Promise});
const {resolvePayment,listPaymentsForReview}=moduleObject.exports;
(async()=>{
  for(const date of ['2026-02-30','2026-13-01','', '09/19/2026']) assert.match((await resolvePayment({paymentId:'payment',receivedDate:date})).error,/valid received date/);
  assert.equal(writes.length,0);
  role='field';
  assert.match((await resolvePayment({paymentId:'payment',description:'changed'})).error,/authorized/);
  await assert.rejects(()=>listPaymentsForReview('payment'),/authorized/);
  assert.equal(writes.length,0);
  role='owner';
  assert.equal((await resolvePayment({paymentId:'payment',receivedDate:'2024-02-29',referenceNumber:' check ',description:' progress ',amount:120})).error,undefined);
  assert.equal(writes[0].received_date,'2024-02-29');
  assert.equal(writes[0].reference_number,'check');
  assert.equal(writes[0].description,'progress');
  assert.equal(writes[0].amount,120);
  assert.ok(invalidated.includes('/finances/daily-log'));
  updated=null;
  assert.match((await resolvePayment({paymentId:'missing',amount:120})).error,/not found/);
  filters=[];
  await listPaymentsForReview();
  assert.ok(filters.some(([key,value])=>key==='review_status' && value==='needs_review'));
  filters=[];
  await listPaymentsForReview('payment');
  assert.ok(filters.some(([key,value])=>key==='id' && value==='payment'));
  assert.ok(!filters.some(([key])=>key==='review_status'));
  authenticated=false;
  assert.match((await resolvePayment({paymentId:'payment',amount:120})).error,/authenticated/);
  console.log('PASS: invalid date rejection, financial role gate, payment edits, refresh invalidation, denied/missing row, targeted reads and unchanged review queue');
})().catch(e=>{console.error(e);process.exitCode=1});
