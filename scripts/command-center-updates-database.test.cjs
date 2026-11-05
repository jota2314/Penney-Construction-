/* eslint-disable @typescript-eslint/no-require-imports */
// Real PostgreSQL execution in PGlite; never touches the live database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const migration = fs.readFileSync('supabase/migrations/20261105025051_command_center_cursor_updates.sql', 'utf8');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function page(before = null, limit = 21) {
  return (await db.query('select * from command_center_update_keys($1::timestamptz,$2::text,$3::text,$4::integer)',
    [before?.occurred_at ?? null, before?.source ?? null, before?.source_id ?? null, limit])).rows;
}
(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    create table daily_logs(id uuid primary key,started_at timestamptz not null,status text,text text,photo_storage_paths text[],visible boolean default true);
    create table company_feed_posts(id uuid primary key,created_at timestamptz not null,visible boolean default true);
    create table todos(id uuid primary key,category text,created_at timestamptz,punch_session_id uuid,visible boolean default true);
    alter table daily_logs enable row level security;
    alter table company_feed_posts enable row level security;
    alter table todos enable row level security;
    grant select on daily_logs,company_feed_posts,todos to authenticated;
    create policy visible on daily_logs for select to authenticated using(visible);
    create policy visible on company_feed_posts for select to authenticated using(visible);
    create policy visible on todos for select to authenticated using(visible);
  `);
  await db.exec(migration);
  // Timestamp ties across sources and within sources; microsecond distinctions
  // would collapse if application cursors were reconstructed using Date.
  for(let i=1;i<=55;i++) {
    await db.query('insert into daily_logs values($1,$2,$3,$4,$5,true)',
      [uid(i),`2026-11-04T10:00:00.${String(100+i%3).padStart(6,'0')}Z`,i===1?'in_progress':'completed',i===2?null:'update',i===2?['guest/photo.jpg']:[]]);
    if(i<=12) await db.query('insert into company_feed_posts values($1,$2,true)',[uid(100+i),'2026-11-04T10:00:00.000101Z']);
  }
  // Empty clock-outs must not consume page slots; many consecutive ones should
  // not make a page sparse (the old limit*3 scan did).
  await db.exec(`insert into daily_logs select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    '2026-11-05'::timestamptz,'completed',E' \t\n',array[]::text[],true from generate_series(1,100) n;`);
  // 1,105 members still represent a single chronological card, at the earliest
  // member, even though recent members lie ahead of the pagination cursor.
  await db.exec(`insert into todos select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    'punch_list','2026-11-04T10:00:00.000100Z'::timestamptz+(n-1)*interval '1 microsecond','${uid(500)}',true
    from generate_series(1,1105) n;`);
  await db.query('insert into todos values($1,$2,$3,null,true)',[uid(600),'punch_list','2026-11-04T10:00:00.000101Z']);
  await db.query('insert into todos values($1,$2,null,null,true)',[uid(601),'punch_list']);
  await db.query('insert into todos values($1,$2,$3,null,true)',[uid(602),'other','2026-11-05']);
  await db.query('insert into daily_logs values($1,$2,$3,$4,$5,false)',[uid(900),'2026-11-06','completed','hidden',[]]);
  await db.query('insert into company_feed_posts values($1,$2,false)',[uid(901),'2026-11-06']);
  await db.query('insert into todos values($1,$2,$3,null,false)',[uid(902),'punch_list','2026-11-06']);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid(999)}',false);`);
  assert.equal((await page(null,9999)).length,21,'RPC caps arbitrary client limits');
  assert.equal((await page(null,0)).length,1);
  let cursor=null; const seen=[]; const pageSizes=[];
  do {
    const keys=await page(cursor); const visible=keys.slice(0,20);
    seen.push(...visible); pageSizes.push(visible.length);
    cursor=keys.length>20?visible.at(-1):null;
  } while(cursor);
  assert.equal(seen.length,70,'55 logs + 12 company posts + 3 full punch groups');
  assert.deepEqual(pageSizes,[20,20,20,10]);
  assert.equal(new Set(seen.map(row=>row.source+':'+row.source_id)).size,70,'no duplicate source keys across tied pages');
  const group=seen.find(row=>row.source_id===uid(500));
  assert.equal(group.occurred_at,'2026-11-04T10:00:00.000100Z');
  assert.equal(seen.at(-1).source_id,'solo-'+uid(601),'nullable legacy timestamp has stable epoch fallback');
  assert.equal(seen.some(row=>[uid(900),uid(901),'solo-'+uid(902)].includes(row.source_id)),false,'invoker honors all three source RLS policies');
  for(let i=1;i<seen.length;i++) {
    const prev=seen[i-1],cur=seen[i];
    assert.ok([prev.occurred_at,prev.source,prev.source_id].join('|')>[cur.occurred_at,cur.source,cur.source_id].join('|'),'strict descending tuple');
  }
  // Inserting a new head after the first page must not shift or duplicate the
  // next page. A deleted last-row cursor remains a valid position.
  const first=await page(); const boundary=first[19];
  const expected=await page(boundary);
  await db.exec('reset role');
  await db.query('insert into company_feed_posts values($1,$2,true)',[uid(950),'2026-11-07']);
  const table=boundary.source==='daily_log'?'daily_logs':'company_feed_posts';
  await db.query(`delete from ${table} where id=$1`,[boundary.source_id]);
  await db.exec('set role authenticated');
  assert.deepEqual(await page(boundary),expected);
  await assert.rejects(page({occurred_at:null,source:'daily_log',source_id:uid(1)}),/Invalid updates cursor/);
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(page(),/Authentication required/);
  await db.exec('set role anon');
  await assert.rejects(page(),/permission denied/);
  await db.exec('reset role');
  const fn=(await db.query("select prosecdef,proconfig from pg_proc where proname='command_center_update_keys'")).rows[0];
  assert.equal(fn.prosecdef,false);
  assert.ok(fn.proconfig.includes('search_path=""'));
  console.log('Passed: 20-item mixed-source pages, tied microseconds, 1105-member punch grouping, empty clock-outs, RLS/anon isolation, capped limits, insertion/deletion stability.');
  await db.close();
})().catch(async error=>{console.error(error);await db.close();process.exitCode=1;});

