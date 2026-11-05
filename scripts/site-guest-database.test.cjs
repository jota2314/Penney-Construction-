/* eslint-disable @typescript-eslint/no-require-imports */
// Run with @electric-sql/pglite available through NODE_PATH. No live writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const db = new PGlite();
const job = "00000000-0000-4000-8000-000000000001";
const otherJob = "00000000-0000-4000-8000-000000000002";
const author = "00000000-0000-4000-8000-000000000003";
const owner = "00000000-0000-4000-8000-000000000004";
const sub = "00000000-0000-4000-8000-000000000005";
let serial = 100;
const uuid = () => `00000000-0000-4000-8000-${String(serial++).padStart(12, "0")}`;
const time = "2026-11-05T02:00:00.000Z";
async function insert(overrides = {}) {
  const row = {
    id: uuid(), project_id: job, author_id: null, subcontractor_id: null,
    is_site_guest: true, site_guest_name: null, kind: "post", status: "completed",
    started_at: time, ended_at: time, photo_storage_paths: ["guest/photo.jpg"], ...overrides,
  };
  const columns = Object.keys(row);
  await db.query(`insert into daily_logs (${columns.join(",")}) values (${columns.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
  return row.id;
}
const role = (name) => db.exec(`set role ${name}`);
const get = async (id) => (await db.query("select * from daily_logs where id=$1", [id])).rows[0];

(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table profiles(id uuid primary key, role text);
    insert into profiles values ('${author}','field'),('${owner}','owner');
    grant select on profiles to authenticated,service_role;
    create table schedule_phases(id uuid primary key,project_id uuid,estimate_line_item_id uuid);
    grant select on schedule_phases to authenticated,service_role;
    create table daily_logs(
      id uuid primary key, project_id uuid, author_id uuid, subcontractor_id uuid,
      schedule_phase_id uuid, master_phase_id uuid, estimate_line_item_id uuid,
      kind text not null default 'shift', status text not null default 'in_progress',
      started_at timestamptz not null default now(), ended_at timestamptz,
      created_at timestamptz not null default now(), text text, photo_storage_paths text[] not null default '{}',
      line_item_source text, line_item_needs_review boolean not null default false, line_item_note text,
      report_required boolean not null default false, report_submitted_at timestamptz,
      daily_report_id uuid, report_progress jsonb, auto_clocked_out boolean not null default false,
      constraint daily_logs_author_or_sub_check check(author_id is not null or subcontractor_id is not null)
    );
    alter table daily_logs enable row level security;
    grant select,insert,update on daily_logs to anon,authenticated,service_role;
    create policy "Authenticated users can read daily logs" on daily_logs for select to authenticated using(true);
  `);
  await db.exec(fs.readFileSync("supabase/migrations/00069_daily_logs_rls_allow_managers.sql", "utf8"));
  await db.exec(fs.readFileSync("supabase/migrations/20260908225545_link_active_task_on_post.sql", "utf8"));
  await db.exec(fs.readFileSync("supabase/migrations/20261105022833_site_guest_photo_posts.sql", "utf8"));

  await role("service_role");
  const legacyGuest = await insert();
  await db.exec("reset role");
  await db.exec(fs.readFileSync("supabase/migrations/20261105165352_site_guest_worker_details.sql", "utf8"));
  await role("service_role");
  const legacy = await get(legacyGuest);
  assert.equal(legacy.site_guest_name, null);
  assert.equal(legacy.site_guest_trade, null);
  assert.equal(legacy.site_guest_company, null, "migration preserves earlier anonymous photo posts");
  const guest = await insert({ site_guest_name: "Alex", site_guest_trade: "Electrician", site_guest_company: "Example Electric", text: "Installed kitchen wiring." });
  const saved = await get(guest);
  assert.equal(saved.is_site_guest, true);
  assert.equal(saved.author_id, null);
  assert.equal(saved.subcontractor_id, null);
  assert.equal(saved.site_guest_name, "Alex");
  assert.equal(saved.site_guest_trade, "Electrician");
  assert.equal(saved.site_guest_company, "Example Electric");
  assert.equal(saved.text, "Installed kitchen wiring.");
  assert.equal(saved.line_item_needs_review, false, "guest photos create no crew allocation warning");

  for (const patch of [
    { is_site_guest: false }, { author_id: author }, { subcontractor_id: sub },
    { kind: "shift" }, { status: "in_progress" }, { project_id: null }, { ended_at: null },
    { ended_at: "2026-11-05T03:00:00Z" }, { photo_storage_paths: [] },
    { schedule_phase_id: uuid() }, { master_phase_id: uuid() }, { estimate_line_item_id: uuid() },
    { line_item_source: "manual" }, { line_item_needs_review: true }, { line_item_note: "labor" },
    { report_required: true }, { report_submitted_at: time }, { daily_report_id: uuid() },
    { report_progress: {} }, { auto_clocked_out: true }, { site_guest_name: " " },
    { site_guest_name: "x".repeat(121) },
    { site_guest_trade: " " }, { site_guest_trade: "x".repeat(81) },
    { site_guest_company: " " }, { site_guest_company: "x".repeat(101) },
    { is_site_guest: false, author_id: author, site_guest_trade: "Electrician" },
    { is_site_guest: false, subcontractor_id: sub, site_guest_company: "Example Electric" },
  ]) await assert.rejects(insert(patch), /check constraint/, JSON.stringify(patch));

  const subPost = await insert({ is_site_guest: false, subcontractor_id: sub });
  assert.equal((await get(subPost)).line_item_needs_review, false);
  await role("authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [author]);
  const normal = await insert({ is_site_guest: false, author_id: author });
  assert.equal((await get(normal)).line_item_needs_review, true, "existing crew task stamping stays active");
  await assert.rejects(insert(), /row-level security/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await assert.rejects(insert(), /row-level security/, "even a direct manager client cannot spoof a guest");
  const untouched = await db.query("update daily_logs set author_id=$2,is_site_guest=false,site_guest_name=null where id=$1 returning id", [guest, owner]);
  assert.equal(untouched.rows.length, 0, "authenticated cannot convert a guest into a claimed staff record");
  await assert.rejects(db.query("update daily_logs set is_site_guest=true,author_id=null,line_item_needs_review=false where id=$1", [normal]), /row-level security/);

  await role("anon");
  assert.equal((await db.query("select count(*)::int as n from daily_logs")).rows[0].n, 0);
  await assert.rejects(insert(), /row-level security/);

  await role("service_role");
  for (let i = 2; i < 60; i++) await insert();
  await assert.rejects(insert(), /site_guest_hourly_limit/);
  await assert.rejects(insert({ id: guest }), /duplicate key/, "idempotent retry reaches the existing PK even at the cap");
  await insert({ project_id: otherJob });
  await insert({ is_site_guest: false, subcontractor_id: sub });
  await db.query("update daily_logs set created_at=now()-interval '2 hours' where id=$1", [guest]);
  await insert();
  console.log("Passed: guest worker details persist, legacy posts survive migration, bounded guest-only fields, no labor/time attribution, unchanged RLS, project hourly cap and retry behavior.");
  await db.close();
})().catch(async (error) => { console.error(error); await db.close(); process.exitCode = 1; });
