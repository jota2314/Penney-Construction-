import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(fs.readFileSync(new URL('../src/lib/crew/labor-ledger.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {calculateLabor,rateOnDate}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const emp={id:'e',profile_id:'p',hourly_rate:60};
const shift=(id,job,start,end)=>({id,project_id:job,author_id:'p',kind:'shift',started_at:`2026-09-10T${start}:00-04:00`,ended_at:end?`2026-09-10T${end}:00-04:00`:null});
const calc=(rows,adj=[],history=[],ledger=new Set())=>calculateLabor(rows,[emp],history,adj,ledger,Date.parse('2026-09-11T20:00:00Z'));
test('one break across two jobs; costs and minutes conserved regardless of input order',()=>{
 const shifts=[shift('a','A','08:00','12:00'),shift('b','B','13:00','17:00')];
 const rows=calc(shifts);assert.deepEqual(rows.map(r=>r.breakMinutes),[15,15]);assert.equal(rows.reduce((s,r)=>s+r.paidMinutes,0),450);assert.equal(rows.reduce((s,r)=>s+r.wageCents,0),45000);
 assert.deepEqual(calc(shifts.toReversed()).toReversed(),rows);
});
test('rounding conserves one 30 minute break over uneven short shifts',()=>{
 const rows=calc([shift('a','A','08:00','08:17'),shift('b','B','09:00','09:18'),shift('c','C','10:00','10:19')]);
 assert.equal(rows.reduce((s,r)=>s+r.breakMinutes,0),30);assert.equal(rows.reduce((s,r)=>s+r.paidMinutes,0),24);
});
test('explicit zero lunch override survives; long break cannot create negative cost',()=>{
 const a=shift('a','A','08:00','09:00');
 assert.equal(calc([a],[{profile_id:'p',work_date:'2026-09-10',break_minutes:0}])[0].paidMinutes,60);
 assert.equal(calc([a],[{profile_id:'p',work_date:'2026-09-10',break_minutes:90}])[0].paidMinutes,0);
});
test('ledger job keeps hours and modeled wages but contributes no additional project cost',()=>{
 const row=calc([shift('a','A','08:00','16:00')],[],[],new Set(['A']))[0];
 assert.equal(row.wageCents,45000);assert.equal(row.projectCostCents,0);assert.equal(row.paidMinutes,450);
});
test('rate history uses effective date; unknown prehistory is not current rate',()=>{
 const history=[{employee_id:'e',effective_date:'2026-01-01',previous_rate:null,new_rate:40},{employee_id:'e',effective_date:'2026-09-11',previous_rate:40,new_rate:60}];
 assert.equal(calc([shift('a','A','08:00','16:00')],[],history)[0].wageCents,30000);
 assert.equal(rateOnDate(emp,'2026-09-11',history),60);assert.equal(rateOnDate(emp,'2025-12-31',history),null);
});
test('posts excluded even with accidental duration; open shifts capped and kept provisional',()=>{
 const rows=calc([{...shift('post','A','08:00','16:00'),kind:'post'},shift('open','A','08:00',null)]);
 assert.equal(rows.length,1);assert.equal(rows[0].rawMinutes,720);assert.equal(rows[0].open,true);assert.equal(rows[0].breakMinutes,0);
});
test('bad timestamps and reversed or sub-minute closed shifts do not inflate cost',()=>{
 const rows=calc([{...shift('bad','A','08:00','16:00'),started_at:'invalid'},shift('reverse','A','16:00','08:00')]);
 assert.equal(rows.length,1);assert.equal(rows[0].wageCents,0);
});
test('local work day, not UTC day, picks the override',()=>{
 const row=calc([{...shift('late','A','20:00','21:00'),started_at:'2026-09-11T00:00:00Z',ended_at:'2026-09-11T01:00:00Z'}],[{profile_id:'p',work_date:'2026-09-10',break_minutes:0}])[0];
 assert.equal(row.paidMinutes,60);
});
test('clock job: days already booked from the ledger keep hours and wages but add no project cost',()=>{
 const through=new Map([['A','2026-09-10']]);
 const covered=calculateLabor([shift('a','A','08:00','16:00')],[emp],[],[],new Set(),Date.parse('2026-09-11T20:00:00Z'),through)[0];
 assert.equal(covered.wageCents,45000);assert.equal(covered.projectCostCents,0);assert.equal(covered.paidMinutes,450);
 const after=calculateLabor([{...shift('b','A','08:00','16:00'),started_at:'2026-09-11T08:00:00-04:00',ended_at:'2026-09-11T16:00:00-04:00'}],[emp],[],[],new Set(),Date.parse('2026-09-12T20:00:00Z'),through)[0];
 assert.equal(after.projectCostCents,45000);
 const otherJob=calculateLabor([shift('c','B','08:00','16:00')],[emp],[],[],new Set(),Date.parse('2026-09-11T20:00:00Z'),through)[0];
 assert.equal(otherJob.projectCostCents,45000);
});
