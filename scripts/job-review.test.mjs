import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const url = file => new URL(file, import.meta.url);
const moduleURL = file => {
 let source = fs.readFileSync(url(file), 'utf8');
 if (file.endsWith('engine.ts')) source = source.replace('"../crew/labor-ledger"', JSON.stringify(moduleURL('../src/lib/crew/labor-ledger.ts'))).replace('"../estimates/current"', JSON.stringify(moduleURL('../src/lib/estimates/current.ts'))).replace('"../estimates/line-item-financials"', JSON.stringify(moduleURL('../src/lib/estimates/line-item-financials.ts')));
 return `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')}`;
};
const { calculateReview, sourceRegister, changesSince, fingerprint } = await import(moduleURL('../src/lib/job-review/engine.ts'));
const sources = ['projects','estimates','lines','invoices','daily_logs','schedule_phases','all_day_shifts','employees','rates','breaks','quotes','material_orders','material_returns','time_entries','job_ledger_entries','change_orders','payments_received','client_invoices','field_report_notes','field_report_photos'];
const base = () => ({as_of:'2026-10-08T20:00:00Z',records:{...Object.fromEntries(sources.map(s=>[s,[]])),projects:[{id:'job',name:'Test',status:'audit',contract_locked_amount:1000,contract_estimate_id:'e'}],estimates:[{id:'e',version:1}],lines:[{id:'l',estimate_id:'e',description:'Scope',total_cost:100}]}});
const bill = (id, amount, props={})=>({id,project_id:'job',estimate_line_item_id:'l',amount,review_status:'ok',...props});
test('current contract estimate only; explicit duplicates excluded, split allocations and credits counted once',()=>{
 const s=base();s.records.estimates.push({id:'other',version:2});s.records.lines.push({id:'old',estimate_id:'other',total_cost:9000});
 s.records.invoices=[bill('a',100,{split_group_id:'split'}),bill('b',50,{split_group_id:'split'}),bill('credit',-20),bill('dupe',150,{duplicate_of_id:'a'})];
 const r=calculateReview(s);assert.equal(r.money.cost_budget,10000);assert.equal(r.money.recorded_cost,13000);assert.equal(r.findings[0].amount,3000);assert.equal(r.findings[0].evidence_state,'recorded');
});
test('zero budget and unallocated amounts are not claimed as percentage overruns',()=>{
 const s=base();s.records.lines[0].total_cost=0;s.records.invoices=[bill('a',20),bill('b',30,{estimate_line_item_id:null})];
 const r=calculateReview(s);assert.equal(r.findings[0].kind,'missing_budget');assert.equal(r.findings[1].kind,'allocation_question');assert.equal(r.money.recorded_cost,5000);
});
test('active cost column takes precedence over stale legacy budget, including explicit zero',()=>{
 const s=base();s.records.lines[0].cost=200;s.records.invoices=[bill('a',150)];assert.equal(calculateReview(s).money.cost_budget,20000);assert.equal(calculateReview(s).findings.length,0);
 s.records.lines[0].cost=0;assert.equal(calculateReview(s).findings[0].kind,'missing_budget');
});
test('only unbilled accepted commitments; no double-counting quotes, no invented final profit',()=>{
 const s=base();s.records.invoices=[bill('a',80,{quote_request_id:'q'})];s.records.quotes=[{id:'q',status:'accepted',amount:120,estimate_line_item_id:'l'},{id:'u',status:'received',amount:9000}];
 const r=calculateReview(s);assert.equal(r.money.known_unbilled_commitments,4000);assert.equal(r.findings[0].kind,'forecast_risk');assert.equal(r.findings[0].amount,2000);assert.equal(r.money.final_profit,null);
});
test('old record edits and deleted evidence become stale; unresolved findings carry forward',()=>{
 const s=base();s.records.invoices=[bill('a',150)];const register=sourceRegister(s);
 const note={id:'n',title:'Disputed',action:'Confirm scope',classification:'allocation_question',line_id:'l',refs:{'invoices:a':register['invoices:a']},reviewed_at:s.as_of,resolved:false};
 assert.equal(calculateReview(s,[note]).findings[0].kind,'allocation_question');
 s.records.invoices[0].amount=130;assert.deepEqual(changesSince(sourceRegister(s),register).changed,['invoices:a']);assert.equal(calculateReview(s,[note]).coverage.evidence_stale,1);
 s.records.invoices=[];assert.equal(calculateReview(s,[note]).findings[0].evidence_state,'stale');
});
test('drafts are never collections; receipt links and invoice paid fields do not double-count',()=>{
 const s=base();s.records.client_invoices=[{id:'d',status:'draft',amount:9000,due_date:'2020-01-01'}, {id:'i',invoice_number:2,status:'sent',amount:1000,paid_amount:200,sent_to_client_at:'2026-10-05',due_date:'2026-10-10'}];
 s.records.payments_received=[{id:'r',amount:200,client_invoice_id:'i'}];const r=calculateReview(s);
 assert.equal(r.collections.length,1);assert.equal(r.collections[0].remaining,80000);assert.equal(r.collections[0].overdue,false);assert.equal(r.money.received,20000);
});
test('unlinked matching bills cannot make an accepted quote look unbilled twice',()=>{
 const s=base();s.records.invoices=[bill('a',120)];s.records.quotes=[{id:'q',status:'accepted',amount:120,estimate_line_item_id:'l'}];
 const r=calculateReview(s);assert.equal(r.money.known_unbilled_commitments,0);assert.match(r.coverage.gaps[0],/may already be billed/);
});
test('missing amounts are explicit gaps and missing inventories fail closed',()=>{
 const s=base();s.records.invoices=[bill('missing',null)];assert.equal(calculateReview(s).money.cost_is_lower_bound,true);delete s.records.invoices;assert.throws(()=>calculateReview(s),/did not load/);
});
test('canonical fingerprints ignore object key order, not older-row content changes',()=>{
 assert.equal(fingerprint({b:2,a:1}),fingerprint({a:1,b:2}));assert.notEqual(fingerprint({amount:2}),fingerprint({amount:3}));
});
test('priority determines next actions; resolved evidence is retained and reopens if sources change',()=>{
 const s=base();const refs={'projects:job':sourceRegister(s)['projects:job']};
 const old={id:'old',title:'Original issue',action:'Old action',classification:'question',line_id:null,refs,reviewed_at:s.as_of,resolved:false,priority:1};
 const newer={...old,id:'new',supersedes_id:'old',title:'Resolved with evidence',resolved:true};
 const low={...old,id:'low',title:'Routine',action:'Routine task',priority:3};
 const high={...old,id:'high',title:'Urgent',action:'Urgent task',priority:1};
 const r=calculateReview(s,[low,old,newer,high]);assert.equal(r.next_actions[0],'Urgent task');assert.equal(r.findings.filter(f=>f.id==='evidence:old'||f.id==='evidence:new').length,0);
 s.records.projects[0].status='closed';const updated=calculateReview(s,[old,newer]);assert.equal(updated.findings.find(f=>f.id==='evidence:new').evidence_state,'stale');
});
test('verified cost requires versioned originals, and replacing one removes verification',()=>{
 const s=base();s.records.invoices=[bill('a',150,{attachment_storage_path:'receipt.pdf'})];s.records.storage_objects=[{id:'email-attachments/receipt.pdf',path:'receipt.pdf',available:true,etag:'v1'}];
 const register=sourceRegister(s);const refs=Object.fromEntries(['projects:job','lines:l','invoices:a','storage_objects:email-attachments/receipt.pdf'].map(k=>[k,register[k]]));
 const n={id:'n',title:'Cost verified',action:'Checked bill and scope',classification:'verified_cost',line_id:'l',refs,reviewed_at:s.as_of,resolved:false};
 assert.equal(calculateReview(s,[n]).findings.find(f=>f.id==='over:l').evidence_state,'verified');
 s.records.storage_objects[0].etag='v2';assert.equal(calculateReview(s,[n]).findings.find(f=>f.id==='over:l').evidence_state,'recorded');
});
const fixtureRoot=url('../../financial-reviews/b12ec6da-a6ca-4d9e-92ae-80c334c49517/2026-10-08-r03-timed/');
test('Conway reconciles exactly with the saved evidence-backed trial', {skip: !fs.existsSync(new URL('current-records.json',fixtureRoot))},()=>{
 const entries=['current-records.json','supplemental-records.json'].flatMap(f=>JSON.parse(fs.readFileSync(new URL(f,fixtureRoot),'utf8')));
 const s={as_of:'2026-10-08T20:19:30Z',records:Object.fromEntries(entries.map(e=>[e.source,e.records]))};
 const r=calculateReview(s);assert.equal(r.money.recorded_cost,1090642);assert.equal(r.money.modeled_wages,24137);assert.equal(r.money.net_minutes,341);assert.equal(r.money.cost_budget,1640777);assert.equal(r.money.contract_remaining,1492710);assert.equal(r.collections.filter(i=>i.overdue).length,0);assert.equal(r.money.final_profit,null);assert.equal(r.money.known_unbilled_commitments,0);
 console.log(JSON.stringify({conway:r.money,warnings:r.findings.map(f=>({kind:f.kind,scope:f.title,amount:f.amount}))}));
});
