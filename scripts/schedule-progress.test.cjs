const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/schedule/progress.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:mod.exports,module:mod});
const { scheduleProgress, isMasterPhase }=mod.exports;
test('one verified master denominator across all readers; no partial or client credit',()=>{
  const phases=[
    {status:'completed',phase_scope:'master'},
    {status:'in_progress',phase_scope:'master',client_completed:true},
    {status:'not_started',phase_scope:'master',client_completed_at:'2026-10-16'},
    ...Array.from({length:12},()=>({status:'completed',phase_scope:'daily'})),
    {status:'completed',event_type:'crew'},
    {status:'completed',name:'Clock-in — labor'},
  ];
  const p=scheduleProgress(phases);assert.equal(p.total,3);assert.equal(p.completed,1);assert.equal(p.percent,33);assert.equal(p.pendingClientReports,2);assert.equal(p.readyToClose,false);
  assert.equal(scheduleProgress([]).readyToClose,false);
  assert.equal(scheduleProgress([{status:'completed',phase_scope:null}]).readyToClose,true);
  assert.equal(isMasterPhase({phase_scope:'daily',event_type:'inspection'}),false);
});
