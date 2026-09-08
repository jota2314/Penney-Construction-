/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = path => ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const load=(path,require)=>{const c={exports:{},require,console};vm.runInNewContext(compile(path),c);return c.exports};
const progress=load('src/lib/crew/report-progress.ts',require);
const links=load('src/lib/crew/log-work-links.ts',require);
let inserts=[], phaseProject='job', open=true, history=[];
const db={from(table){let body,filters={},past=false;const query={
  select(){return query},eq(k,v){filters[k]=v;return query},in(){return query},
  gte(){past=true;return query},
  insert(value){body=value;inserts.push(value);return query},
  single(){return query},maybeSingle(){return query},
  then(resolve,reject){let data;
    if(table==='daily_logs') data=body?{id:'new-post'}:past?history:open?{schedule_phase_id:'phase',estimate_line_item_id:'stairs'}:null;
    if(table==='schedule_phases')data={project_id:phaseProject,estimate_line_item_id:'stairs'};
    if(table==='projects')data={id:'job',name:'White'};
    return Promise.resolve({data,error:null}).then(resolve,reject);
  },
};return query;}};
const actions=load('src/lib/actions/daily-logs.ts',name=>{
  if(name==='zod')return require(name);
  if(name==='next/cache')return {revalidatePath(){}};
  if(name.includes('supabase/server'))return {createClient:async()=>db};
  if(name.includes('auth/get-user'))return {getUser:async()=>({profile:{id:'worker'}})};
  if(name.includes('crew/report-progress'))return progress;
  if(name.includes('crew/log-work-links'))return links;
  if(name.includes('crew/schedule-dates'))return {crewToday:()=> '2026-09-08'};
  if(name.includes('activity-mentions/groups'))return {isGroupMentionType:()=>false};
  if(name.includes('notifications/tagged-mentions'))return {notifyTaggedProfiles:async()=>{}};
  return {};
});
(async()=>{
  let result=await actions.postDailyLog({projectId:'job'},'Photo update',[],1);
  assert.equal(result.logId,'new-post');assert.equal(inserts[0].author_id,'worker');
  assert.equal(inserts[0].estimate_line_item_id,'stairs');assert.equal(inserts[0].schedule_phase_id,'phase');
  open=false;inserts=[];
  await actions.postDailyLog({projectId:'job'},'After work update',[],1);
  assert.equal(inserts[0].estimate_line_item_id,null);assert.equal(inserts[0].line_item_needs_review,true);
  history=[{id:'shift',author_id:'worker',project_id:'job',started_at:'2026-09-08T12:00Z',ended_at:'2026-09-08T16:00Z',estimate_line_item_id:'stairs'}];inserts=[];
  await actions.postDailyLog({projectId:'job'},'After work photos',[],1);
  assert.equal(inserts[0].estimate_line_item_id,'stairs');
  history.push({...history[0],id:'shift-2',estimate_line_item_id:'demo'});inserts=[];
  await actions.postDailyLog({projectId:'job'},'Mixed tasks today',[],1);
  assert.equal(inserts[0].estimate_line_item_id,null);
  phaseProject='other-job';inserts=[];
  result=await actions.postDailyLog({projectId:'job',phaseId:'phase'},'Photo update',[],1);
  assert.ok(result.error);assert.equal(inserts.length,0);
  console.log('Actual postDailyLog action: photo/update inherits own active budget task, missing task stays flagged, mismatched job/phase rejected.');
})().catch(error=>{console.error(error);process.exitCode=1});
