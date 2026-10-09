import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(file, mocks = {}) {
  const compiled = { exports: {} };
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    if (name in mocks) return mocks[name];
    if (name === './payment-date') return load('src/lib/finance/payment-date.ts');
    if (name === './collection-plan') return load('src/lib/finance/collection-plan.ts');
    throw new Error(`Unexpected import ${name}`);
  }, compiled, compiled.exports);
  return compiled.exports;
}
const { buildCollectionPlan } = load('src/lib/finance/collection-plan.ts');
const project = { id: 'job', name: 'Test job', contract_value: 10000, contract_locked_amount: 10000, outstanding: 10000 };
const invoice = { id: 'invoice', project_id: 'job', title: 'Draw', amount: 1000, paid_amount: 0, status: 'sent', sent_to_client_at: '2026-10-08T12:00:00Z', due_date: '2026-10-09', source: 'manual' };
const milestone = { id: 'draw', project_id: 'job', label: 'Tile complete', stage_key: 'custom', amount: 2000, percent: null, status: 'pending', client_invoice_id: null };
const phase = { project_id: 'job', name: 'Tile installation', start_date: '2026-10-09', end_date: '2026-10-10', planned_start_date: null, planned_end_date: null, status: 'pending', phase_scope: 'master', event_type: 'phase' };
const run = (overrides = {}) => buildCollectionPlan({ today: '2026-10-09', projects: [project], invoices: [], milestones: [], phases: [], receipts: [], ...overrides });

test('remaining week/month exclude past-due and undated amounts', () => {
  const p = run({ invoices: [invoice, {...invoice,id:'later',due_date:'2026-10-31'}, {...invoice,id:'next',due_date:'2026-11-01'}, {...invoice,id:'late',due_date:'2026-10-08'}, {...invoice,id:'undated',due_date:null}] });
  assert.equal(p.week, 1000); assert.equal(p.month, 2000); assert.equal(p.overdue, 1000);
  assert.equal(p.weekStart, '2026-10-05'); assert.equal(p.weekEnd, '2026-10-11');
  assert.equal(p.needsDate, 6000);
});
test('invoice and linked milestone count once; linked receipts reduce the balance', () => {
  const p = run({ invoices: [invoice], milestones: [{...milestone,client_invoice_id:'invoice'}], phases: [phase], receipts: [{ project_id:'job',client_invoice_id:'invoice',amount:250 }] });
  assert.equal(p.week, 750); assert.equal(p.items.length, 1); assert.equal(p.reviewProjects, 1);
});
test('does not add recorded paid amount and linked receipt twice', () => {
  const p = run({ invoices: [{...invoice,paid_amount:250}], receipts: [{project_id:'job',client_invoice_id:'invoice',amount:250}] });
  assert.equal(p.week,750); assert.equal(p.reviewProjects,0);
});
test('excludes void, paid, imported QuickBooks, and standalone drafts', () => {
  const p = run({ invoices: [{...invoice,status:'void'}, {...invoice,id:'paid',status:'paid'}, {...invoice,id:'qb',source:'qb_import'}, {...invoice,id:'draft',status:'draft'}] });
  assert.equal(p.week,0); assert.equal(p.items.length,0);
});
test('draft-linked milestone uses schedule date and invoice amount, once', () => {
  const p = run({ invoices: [{...invoice,status:'draft',sent_to_client_at:null,due_date:'2026-10-09'}], milestones: [{...milestone,client_invoice_id:'invoice'}, {...milestone,id:'duplicate',client_invoice_id:'invoice'}], phases: [{...phase,end_date:'2026-10-20'}] });
  assert.equal(p.week,0); assert.equal(p.month,1000); assert.equal(p.items.length,1); assert.equal(p.items[0].basis,'milestone');
});
test('all named trades must be scheduled; crew assignments cannot date a draw', () => {
  const p = run({ milestones:[{...milestone,label:'Tile and plaster complete'}], phases:[phase] });
  assert.equal(p.week,0); assert.equal(p.items[0].date,null);
  assert.equal(run({milestones:[milestone],phases:[{...phase,phase_scope:'crew',event_type:'crew'}]}).week,0);
  const complete = run({milestones:[{...milestone,label:'Tile and plaster complete'}],phases:[phase,{...phase,name:'Plaster',end_date:'2026-10-20'}]});
  assert.equal(complete.week,0); assert.equal(complete.month,2000);
});
test('past milestones need replanning and are not called overdue invoices', () => {
  const p = run({milestones:[milestone],phases:[{...phase,end_date:'2026-10-08'}]});
  assert.equal(p.week,0); assert.equal(p.overdue,0); assert.equal(p.needsDate,10000);
});
test('conflicting job balance is excluded instead of allocating receipts by guess', () => {
  const p = run({projects:[{...project,outstanding:500}],invoices:[invoice]});
  assert.equal(p.week,0); assert.equal(p.needsDate,500); assert.equal(p.reviewProjects,1); assert.equal(p.items.length,0);
});
test('week crosses month/year correctly and keeps cents', () => {
  const p = run({today:'2026-12-31',invoices:[{...invoice,due_date:'2027-01-01',amount:1000.25}]});
  assert.equal(p.weekEnd,'2027-01-03'); assert.equal(p.monthEnd,'2026-12-31'); assert.equal(p.week,1000.25); assert.equal(p.month,0);
});
test('uses signed contract for percentage milestones and reports missing sources', () => {
  const p = run({milestones:[{...milestone,amount:null,percent:12.5}],phases:[phase]});
  assert.equal(p.week,1250);
  assert.equal(run({milestones:[{...milestone,client_invoice_id:'missing'}]}).reviewProjects,1);
});

function dataLoader(result) {
  const client = { from(table) {
    const builder = { select() { return builder; }, in() { return builder; }, eq() { return builder; }, order() { return builder; }, range(from, to) { return Promise.resolve(result(table, from, to)); } };
    return builder;
  } };
  return load('src/lib/finance/collection-plan-data.ts', {
    'server-only': {}, '@/lib/supabase/server': { createClient: async () => client },
  }).getCollectionPlan;
}
test('failed forecast reads return unavailable instead of zero', async () => {
  const getPlan = dataLoader(() => ({data:null,error:{message:'Unavailable test source'}}));
  assert.equal(await getPlan([project], '2026-10-09'), null);
});
test('forecast reads every page beyond the 1000-row API limit', async () => {
  const invoices = Array.from({length:1001}, (_, i) => ({...invoice,id:`i${i}`,amount:1}));
  const getPlan = dataLoader((table, from, to) => ({data:table==='client_invoices'?invoices.slice(from,to+1):[],error:null}));
  assert.equal((await getPlan([project], '2026-10-09')).week, 1001);
});

if (process.env.COLLECTION_SNAPSHOT) {
  const plan = buildCollectionPlan(JSON.parse(readFileSync(process.env.COLLECTION_SNAPSHOT, 'utf8')));
  console.log(JSON.stringify({week:plan.week,month:plan.month,overdue:plan.overdue,needsDate:plan.needsDate,reviewProjects:plan.reviewProjects,datedItems:plan.items.filter(i=>i.date).length}));
}

