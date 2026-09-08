/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { indexedDB } = require('fake-indexeddb');
const compile = path => ts.transpileModule(fs.readFileSync(path,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function moduleAt(path, additions = {}, dependencies = {}) {
  const context = vm.createContext({exports:{}, console, Blob, File, FormData, crypto, AbortController,
    setTimeout, clearTimeout, indexedDB, ...additions,
    require:name => dependencies[name] ?? require(name)});
  vm.runInContext(compile(path), context);
  return context.exports;
}
const storage = moduleAt('src/lib/upload/persisted-photos.ts');
const { logWorkLinks } = moduleAt('src/lib/crew/log-work-links.ts');
const post = {id:'report',author_id:'worker',project_id:'job',started_at:'2026-09-08T20:00Z',ended_at:'2026-09-08T20:00Z'};
const shift = {id:'shift',author_id:'worker',project_id:'job',daily_report_id:'report',started_at:'2026-09-08T12:00Z',ended_at:'2026-09-08T16:00Z',estimate_line_item_id:'stairs',line_item:{description:'Stairs CO'},phase:{estimate_line_item_id:'wrong',line_item:{description:'Wrong task'}}};
let links = logWorkLinks(post,[shift,shift,{...shift,id:'wrong-author',author_id:'other'}]);
assert.equal(links.length,1); assert.equal(links[0].lineItemId,'stairs'); assert.equal(links[0].hours,4);
links = logWorkLinks(post,[shift,{...shift,id:'second',estimate_line_item_id:'baseboard',line_item:{description:'Baseboard'},ended_at:'2026-09-08T14:00Z'}]);
assert.equal(links.length,2); assert.equal(links.reduce((n,r)=>n+r.hours,0),6);
assert.equal(logWorkLinks({...post,estimate_line_item_id:'stairs',line_item:{description:'Stairs CO'}},[])[0].hours,null);
assert.equal(logWorkLinks(post,[])[0].lineItemId,null);
console.log('Work links: correct worker/project, direct line wins, duplicate shifts excluded, multi-task hours separate, photos carry no invented hours.');

const waitUntil = async predicate => { for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,20));}throw new Error('Timed out'); };
const queueAt = fetch => moduleAt('src/lib/upload/daily-log-upload-queue.ts', {fetch, console:{error(){}},
  setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer;},
}, {'./persisted-photos':storage,'@/lib/image/compress':{compressImage:async file=>file}});

(async()=>{
  const requests=[];
  const first=queueAt(async(_url,{body})=>{requests.push({id:body.get('uploadId'),log:body.get('logId')});throw new Error('Connection lost');});
  await first.enqueueDailyLogPhotos('own-log',[new File(['photo bytes'],'photo.jpg',{type:'image/jpeg'})]);
  await waitUntil(()=>requests.length===3);
  const saved=await storage.loadPhotos();
  assert.equal(saved.length,1); assert.equal(await saved[0].file.text(),'photo bytes');
  assert.equal(new Set(requests.map(r=>r.id)).size,1);
  // New JS session, same IndexedDB: simulate fully closing and reopening the app.
  const restored=[];
  const second=queueAt(async(_url,{body})=>{restored.push({id:body.get('uploadId'),log:body.get('logId')});return {ok:true};});
  const unsubscribe=second.subscribeUploadQueue(()=>{});
  await waitUntil(async()=> (await storage.loadPhotos()).length===0);
  unsubscribe();
  assert.equal(restored.length,1); assert.equal(restored[0].id,requests[0].id); assert.equal(restored[0].log,'own-log');
  const unavailable = moduleAt('src/lib/upload/persisted-photos.ts',{indexedDB:undefined});
  await assert.rejects(unavailable.savePhotos([{id:'x',logId:'y',file:new Blob(['z'])}]));
  console.log('Photos: committed before queue returns, retained after three failures, recovered after app restart with the same log/upload ID, removed only after success, unavailable device storage fails explicitly.');
})().catch(error=>{console.error(error);process.exitCode=1;});
