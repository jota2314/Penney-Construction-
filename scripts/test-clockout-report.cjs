const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const load=(path,req)=>{const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:req,URL,window});return exports;};
let selected=null, effects=[];
const window={location:{href:'https://example.com/crew?report=second'},history:{state:{},replaceState(_a,_b,url){window.location.href=url;}}};
const {groupPendingReports}=load('src/lib/crew/pending-reports.ts',()=>({crewToday:()=> '2026-09-08'}));
const base={project_id:'job',started_at:'2026-09-08T12:00:00Z',ended_at:'2026-09-08T13:00:00Z',report_required:true,report_submitted_at:null,status:'completed'};
const reports=groupPendingReports([{...base,id:'first'},{...base,id:'second'}],new Map([['job','Test job']]));
assert.equal(reports.length,1);assert.equal(reports[0].minutes,120);
const {DailyReportsDue}=load('src/components/crew/daily-reports-due.tsx',name=>{
 if(name==='react')return {useState:()=>[selected,x=>selected=x],useEffect:fn=>effects.push(fn)};
 if(name==='react/jsx-runtime')return {jsx:()=>null,jsxs:()=>null};
 if(name.includes('tokens'))return {v:()=>''};
 if(name.includes('schedule-dates'))return {scheduleDateLabel:()=>''};
 return {};
});
DailyReportsDue({reports,unavailable:false});effects.forEach(f=>f());
assert.equal(selected.logId,'first');assert.equal(window.location.href,'https://example.com/crew');
selected=null;effects=[];window.location.href='https://example.com/crew?report=someone-else';
DailyReportsDue({reports,unavailable:false});effects.forEach(f=>f());assert.equal(selected,null);
console.log('PASS: clock-out of second task opens its grouped daily report, consumes request once, and cannot select another worker’s absent report.');

