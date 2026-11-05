/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file,mocks={}) {
  const context={exports:{},console,Buffer,require(name){
    if(name in mocks)return mocks[name];
    if(name==='zod')return require('zod');
    return {};
  }};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return context.exports;
}
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const at='2026-11-04T10:00:00.123456Z';
const cursor=load('src/lib/feed/update-cursor.ts');
const contract=load('src/lib/feed/command-center-updates.ts');
const keys=Array.from({length:21},(_,i)=>({source:['daily_log','company_post','punch_group'][i%3],source_id:uid(i+1),occurred_at:at}));
const daily=keys.filter(k=>k.source==='daily_log').map(k=>({id:k.source_id,text:'Update',photo_storage_paths:['daily.jpg'],status:'completed',started_at:at,author_id:uid(900),author:{full_name:'Crew'},project:{name:'Project'}}));
daily[0]={...daily[0],author_id:null,is_site_guest:true,site_guest_name:'Electrician'};
const older={...daily[1],id:uid(800)};daily.push(older);
const company=keys.filter(k=>k.source==='company_post').map(k=>({id:k.source_id,body:'Company update',photo_storage_paths:['company.jpg'],created_at:at,tagged_entities:[]}));
const todos=keys.filter(k=>k.source==='punch_group').flatMap((k,i)=>Array.from({length:i===0?1105:1},(_,j)=>({id:uid(10000+i*2000+j),punch_session_id:k.source_id,created_at:at,created_by:uid(900),description:'[Kitchen] Fix',creation_photo_paths:['punch.jpg'],completion_photo_path:'done.jpg',status:'open'})));
const soloId=uid(990);todos.push({id:soloId,punch_session_id:null,created_at:at,creation_photo_paths:[]});
const tables={daily_logs:daily,company_feed_posts:company,todos,profiles:[{id:uid(900),full_name:'Crew',email:null}]};
const queries=[];const commentRequests=[];let rpcError=null;let tableError=null;let rpcCalls=0;let rpcKeys=keys;
function query(table) {
  const request={table,filters:[],start:0,end:Infinity,limit:Infinity};queries.push(request);
  return {
    select(){return this;},eq(){return this;},order(){return this;},
    in(field,ids){request.filters.push({field,ids:Array.from(ids)});return this;},
    or(filter){request.or=filter;return this;},
    limit(n){request.limit=n;return this;},range(start,end){request.start=start;request.end=end;return this;},
    then(resolve){
      let rows=tables[table]??[];
      for(const {field,ids} of request.filters) rows=rows.filter(row=>ids.includes(row[field]));
      if(request.or){
        const sessions=/punch_session_id\.in\.\(([^)]+)\)/.exec(request.or)?.[1].split(',')??[];
        const solos=/(?:^|and\()id\.in\.\(([^)]+)\)/.exec(request.or)?.[1].split(',')??[];
        rows=rows.filter(row=>sessions.includes(row.punch_session_id)||(row.punch_session_id===null&&solos.includes(row.id)));
      }
      rows=rows.slice(request.start,Math.min(request.end+1,request.limit));
      resolve({data:tableError===table?null:rows,error:tableError===table?{message:'network failure'}:null});
    }
  };
}
const client={from:query,async rpc(name,args){rpcCalls++;assert.equal(name,'command_center_update_keys');assert.equal(args.p_limit,21);return{data:rpcKeys,error:rpcError};}};
const common={
  '@/lib/supabase/server':{createClient:async()=>client},
  '@/lib/feed/update-cursor':cursor,
  '@/lib/actions/feed-comments':{listFeedCommentsForSources:async(source,ids)=>{commentRequests.push({source,ids:Array.from(ids)});return[];}},
  '@/lib/storage/signed-url-cache':{cachedSignedUrls:async()=>{throw new Error('Unsigned feed must not sign photos');}},
  '@/lib/image/transform-signed-url':{signThumbUrls:async()=>{throw new Error('Unsigned feed must not sign thumbnails');}},
};
const logs=load('src/lib/actions/daily-logs.ts',{
  ...common,
  '@/lib/site-qr/guest-author':load('src/lib/site-qr/guest-author.ts'),
  '@/lib/crew/log-work-links':{logWorkLinks:()=>[]},
});
const posts=load('src/lib/actions/company-feed.ts',common);
const api=load('src/lib/actions/command-center-updates.ts',{
  ...common,'@/lib/feed/command-center-updates':contract,
  '@/lib/actions/daily-logs':logs,'@/lib/actions/company-feed':posts,
});
const plain=value=>JSON.parse(JSON.stringify(value));
(async()=>{
  const result=await api.getCommandCenterUpdatesPage();
  assert.equal(result.items.length,20);
  assert.deepEqual(plain(cursor.decodeUpdateCursor(result.nextCursor)),keys[19]);
  assert.equal(cursor.decodeUpdateCursor(result.nextCursor).occurred_at,at,'microseconds survive cursor encode/decode');
  assert.equal(result.items[0].log.author_name,'Electrician · Job-site guest');
  assert.equal(result.items[0].log.work_items.length,0);
  assert.equal(result.items[0].log.photo_storage_paths[0],'daily.jpg');
  assert.equal(result.items[0].log.photo_signed_urls.length,0);
  assert.equal(result.items[1].post.photoStoragePaths[0],'company.jpg');
  assert.equal(result.items[1].post.photoUrls.length,0);
  assert.equal(result.items[2].group.items.length,1105,'selected punch group hydration spans1000 row cap');
  assert.equal(result.items[2].group.items[0].photo_storage_paths[0],'punch.jpg');
  assert.equal(result.items[2].group.items[0].completion_photo_path,'done.jpg');
  assert.equal(result.items[2].group.items[0].completion_photo_url,null);
  const selected=new Set(keys.slice(0,20).map(k=>k.source_id));
  for(const request of queries.filter(r=>r.table==='daily_logs'||r.table==='company_feed_posts')) {
    assert.ok(request.filters.length,'every source read is targeted');
    for(const filter of request.filters) assert.ok(filter.ids.every(id=>selected.has(id)),'never hydrate lookahead or unrelated history');
  }
  assert.ok(commentRequests.every(r=>r.ids.every(id=>selected.has(id))));
  assert.ok(queries.filter(r=>r.table==='todos').every(r=>!r.or.includes(keys[20].source_id)),'lookahead punch group is not hydrated');
  queries.length=0;commentRequests.length=0;
  assert.equal((await api.getCommandCenterFocusedUpdate(older.id)).log.id,older.id);
  assert.ok(queries.filter(r=>r.table==='daily_logs'||r.table==='company_feed_posts').every(r=>r.filters.every(f=>f.ids.length===1&&f.ids[0]===older.id)),'old notification reads exact source id only');
  assert.equal((await api.getCommandCenterFocusedUpdate('solo-'+soloId)).group.session_id,'solo-'+soloId);
  assert.equal(await api.getCommandCenterFocusedUpdate('malformed'),null);
  const beforeCalls=rpcCalls;
  for(const bad of ['', 'not-json','='.repeat(600),Buffer.from(JSON.stringify({...keys[0],v:1,occurred_at:'2026-02-30T00:00:00.000000Z'})).toString('base64url')]) {
    await assert.rejects(api.getCommandCenterUpdatesPage(bad),/Invalid updates cursor/);
  }
  assert.equal(rpcCalls,beforeCalls,'invalid cursors never reach database');
  rpcError={message:'unavailable'};
  await assert.rejects(api.getCommandCenterUpdatesPage(),/Updates could not load/);
  rpcError=null;tableError='daily_logs';
  await assert.rejects(api.getCommandCenterUpdatesPage(),/Daily logs could not load/);
  tableError='company_feed_posts';
  await assert.rejects(api.getCommandCenterUpdatesPage(),/Company posts could not load/);
  tableError='todos';
  await assert.rejects(api.getCommandCenterUpdatesPage(),/Punch lists could not load/);
  tableError=null;rpcKeys=[];
  const empty=await api.getCommandCenterUpdatesPage();assert.equal(empty.items.length,0);assert.equal(empty.nextCursor,null);
  let signedIn=false, cacheReads=0;
  const signingMocks={
    '@/lib/supabase/server':{createClient:async()=>({auth:{getClaims:async()=>({data:signedIn?{claims:{sub:uid(900)}}:null})}})},
    '@/lib/storage/signed-url-cache':{cachedSignedUrls:async(_client,_bucket,paths)=>{
      cacheReads++;return{data:paths.map(path=>({path,signedUrl:'cached:'+path}))};
    }},
    '@/lib/image/transform-signed-url':{signThumbUrls:async()=>new Map()},
  };
  const signCompany=load('src/lib/actions/company-feed.ts',signingMocks).signCompanyFeedPhotos;
  const signDaily=load('src/lib/actions/daily-logs.ts',signingMocks).signDailyLogPhotos;
  await assert.rejects(signCompany(['known-private.jpg']),/Sign in/);
  await assert.rejects(signDaily(['known-private.jpg']),/Sign in/);
  assert.equal(cacheReads,0,'anonymous requests cannot read warm cross-user URL cache');
  signedIn=true;
  assert.deepEqual(plain(await signCompany(['company.jpg','company.jpg'])),{'company.jpg':{full:'cached:company.jpg',thumb:'cached:company.jpg'}});
  await assert.rejects(signCompany(Array(101).fill('photo.jpg')),/Invalid photo paths/);
  console.log('Passed: selected20-only hydration,1105 complete punch items, no eager signing, guest attribution, targeted old notifications, strict microsecond cursors, source failures propagate for retry.');
})().catch(error=>{console.error(error);process.exitCode=1;});
