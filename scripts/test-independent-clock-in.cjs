/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, mocks = {}, globals = {}) {
  const context = { exports: {}, console, setTimeout, clearTimeout,
    require: name => name in mocks ? mocks[name] : name.startsWith('@/') || name.startsWith('./') ? {} : require(name), ...globals };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return context.exports;
}
const delay = () => new Promise(resolve => setImmediate(resolve));
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node)
  : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
const buttons = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(buttons)
  : [...(node.type === 'button' ? [node] : []), ...buttons(node.props?.children)];

async function pickerTest(documentMode, actionMode) {
  let cursor = 0;
  const cells = [], effects = [], transitions = [], calls = [];
  const same = (a,b) => a && b && a.length === b.length && a.every((v,i) => Object.is(v,b[i]));
  const hooks = {
    useState(initial) { const i=cursor++; if (!(i in cells)) cells[i]=typeof initial==='function'?initial():initial;
      return [cells[i],v=>{ cells[i]=typeof v==='function'?v(cells[i]):v; }]; },
    useRef(initial) { const i=cursor++; return cells[i] ??= { current: initial }; },
    useMemo(fn,deps) { const i=cursor++; if (!cells[i] || !same(cells[i].deps,deps)) cells[i]={ deps, value:fn() }; return cells[i].value; },
    useCallback(fn,deps) { return hooks.useMemo(()=>fn,deps); },
    useEffect(fn,deps) { const i=cursor++; if (!cells[i] || !same(cells[i].deps,deps)) { cells[i]={deps}; effects.push(fn); } },
    useTransition() { const [pending,setPending]=hooks.useState(false); return [pending,fn=>{
      setPending(true); const task=Promise.resolve().then(fn).finally(()=>setPending(false)); transitions.push(task);
    }]; },
  };
  const job = { id:'job',name:'Unassigned job',project_number:'PC-1',address:null,city:null,state:null,latitude:null,longitude:null };
  const actions = {
    searchActiveJobs: async()=>[job],
    getJobBudgetLines: async()=>[{ id:'line',description:'Finish carpentry',section:null,is_today:false,is_change_order:false }],
    clockInOnLineItem: async(...args)=>{ calls.push(args); if(actionMode==='throw') throw Error('network'); return {logId:'recorded-shift'}; },
  };
  const { JobClockInSheet } = load('src/components/field-feed/job-clock-in-sheet.tsx', {
    react: hooks, 'next/navigation':{ useRouter:()=>({refresh(){}}) }, './tokens':{v:()=>''},
    '@/lib/actions/daily-logs': actions,
    '@/lib/geo/current-position':{getCurrentPosition:async()=>null},
    '@/lib/actions/project-files':{ getCrewJobDocuments:()=>documentMode==='reject'?Promise.reject(Error('docs')):new Promise(()=>{}) },
  }, { window:{},document:{body:{style:{}}},requestAnimationFrame:()=>0,cancelAnimationFrame(){} });
  let closed=false;
  const render=()=>{cursor=0;const tree=JobClockInSheet({onClose:()=>{closed=true;},selectTaskFirst:true,initialJob:job});
    while(effects.length) effects.shift()(); return tree;};
  render(); await delay(); await delay(); let tree=render();
  assert.match(text(tree),/Finish carpentry/);
  assert.doesNotMatch(text(tree),/Loading the budget/);
  const choice=buttons(tree).find(b=>text(b).includes('Finish carpentry'));
  assert.ok(choice && !choice.props.disabled);
  choice.props.onClick(); await Promise.all(transitions); tree=render();
  assert.equal(calls.length,1); assert.equal(calls[0][0],'job');assert.equal(calls[0][1],'line');
  if(actionMode==='throw'){ assert.equal(closed,false);assert.match(text(tree),/Could not confirm clock-in/); }
  else assert.equal(closed,true);
}

(async()=>{
  for (const mode of ['missing','denied','throws','silent','success']) {
    let success;
    const geo = mode==='missing'?{}:{ geolocation:{getCurrentPosition(ok,fail){ success=ok;
      if(mode==='denied')fail();if(mode==='throws')throw Error('unavailable');if(mode==='success')ok({coords:{latitude:1,longitude:2,accuracy:3}});
    }}};
    const {getCurrentPosition}=load('src/lib/geo/current-position.ts',{}, {navigator:geo});
    const result=await getCurrentPosition(10);
    assert.equal(result?.lat??null,mode==='success'?1:null);
    if(mode==='silent')success({coords:{latitude:1,longitude:2,accuracy:3}});
  }
  console.log('GPS: denial, exceptions and missing callbacks cannot strand clock-in; success is preserved.');
  await pickerTest('silent','ok'); await pickerTest('reject','ok'); await pickerTest('silent','throw');
  console.log('Actual task picker: unassigned job can clock into chosen budget line despite hung/failed documents; network failure remains visible and retryable.');
  const writes=[];
  const db={from(table){
    let operation='read',payload,columns='';
    const query={ select(value){columns=value;return query;},eq(){return query;},lte(){return query;},gte(){return query;},order(){return query;},limit(){return query;},
      insert(value){operation='insert';payload=value;return query;},update(value){operation='update';payload=value;return query;},
      async result(){
        if(operation!=='read'){writes.push({table,operation,payload});return {data:{id:table==='schedule_phases'?'new-phase':'new-shift'},error:null};}
        if(table==='estimate_line_items')return {data:{id:'chosen-line',description:'Finish carpentry',is_locked:false,estimate:{project_id:'chosen-job'}},error:null};
        if(table==='employees')return {data:{id:'serj-employee'},error:null};
        if(table==='schedule_phases' && columns.includes('projects:'))return {data:{project_id:'chosen-job',estimate_line_item_id:'chosen-line',projects:{}},error:null};
        return {data:null,error:null};
      },single(){return query.result();},maybeSingle(){return query.result();},then(resolve,reject){return query.result().then(resolve,reject);},
    }; return query;
  }};
  const server=load('src/lib/actions/daily-logs.ts',{
    '@/lib/supabase/server':{createClient:async()=>db},
    '@/lib/auth/get-user':{getUser:async()=>({id:'serj',profile:{id:'serj'}})},
    '@/lib/actions/daily-reports':{dailyReportClockInError:async()=>null},
    'next/cache':{revalidatePath(){}},
  });
  const recorded=await server.clockInOnLineItem('chosen-job','chosen-line',null);
  assert.equal(recorded.logId,'new-shift');
  const createdPhase=writes.find(w=>w.table==='schedule_phases').payload;
  assert.equal(createdPhase.assigned_employee_ids[0],'serj-employee');
  assert.equal(createdPhase.estimate_line_item_id,'chosen-line');
  const recordedShift=writes.find(w=>w.table==='daily_logs'&&w.operation==='insert').payload;
  assert.equal(recordedShift.estimate_line_item_id,'chosen-line');
  assert.equal(recordedShift.author_id,'serj');
  assert.equal(recordedShift.line_item_needs_review,false);
  console.log('Actual server action: no existing assignment creates a daily task and records the chosen job/budget line on the shift.');
  const stub=()=>null;
  const {CrewFlow}=load('src/components/crew/crew-flow.tsx',{
    'next/navigation':{useRouter:()=>({})},
    '@/lib/crew/schedule-dates':{scheduleDateLabel:()=>''},
    '@/components/field-feed/tokens':{v:()=>'',PCC_TOKENS:{}},
    '@/components/crew/daily-reports-due':{DailyReportsDue:stub},
    './daily-reports-due':{DailyReportsDue:stub},
    './receipt-capture':{ReceiptCapture:stub},
    './crew-schedule':{CrewSchedule:stub},
    '@/components/crew/crew-schedule':{CrewSchedule:stub},
    '@/components/crew/receipt-capture':{ReceiptCapture:stub},
  });
  const html=renderToStaticMarkup(React.createElement(CrewFlow,{firstName:'Serj',greeting:'Morning',phases:[],scheduleToday:'2026-09-08',scheduleUnavailable:false,logs:[],hours:{openLog:null},reports:[],reportsUnavailable:false}));
  assert.match(html,/Clock in — choose a job/);
  assert.match(html,/even without an assignment/);
  console.log('Crew home: clock-in remains visible with zero assignments.');
})().catch(error=>{console.error(error);process.exitCode=1;});
