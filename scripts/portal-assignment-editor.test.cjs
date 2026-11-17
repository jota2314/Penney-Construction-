/* eslint-disable @typescript-eslint/no-require-imports */
// Like site-guest-database.test.cjs, provide @electric-sql/pglite via NODE_PATH,
// then run: node --test scripts/portal-assignment-editor.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

function loadTs(file, imports = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const result = {};
  new Function("exports", "require", code)(result, name => imports[name] ?? require(name));
  return result;
}
const job = "00000000-0000-4000-8000-000000000001";
const roster = "00000000-0000-4000-8000-000000000002";
const user = "00000000-0000-4000-8000-000000000003";
const stamp = "2026-10-30T12:00:00.000321+00:00";

test("only the active job roster row at the reviewed version receives the previewed text", async () => {
  const calls = [];
  let role = "project_manager";
  let edited = false;
  const client = { from(table) {
    const q = {
      select() { return this; },
      update(value) { calls.push(value); return this; },
      eq(key, value) { if (table === "project_subcontractors") calls.push([key, value]); return this; },
      maybeSingle() {
        if (table === "projects") return { data: { status: "contracted" } };
        if (edited) return { data: null };
        edited = true;
        return { data: { id: roster } };
      },
    };
    return q;
  } };
  const { savePortalAssignment } = loadTs("src/lib/actions/portal-assignment.ts", {
    "next/cache": { revalidatePath() {} },
    "@/lib/auth/get-user": { getUser: () => ({ profile: { role } }) },
    "@/lib/auth/project-document-access": loadTs("src/lib/auth/project-document-access.ts"),
    "@/lib/auth/scoped-projects": { getScopedProjectIds: () => null },
    "@/lib/site-qr/scope-text": loadTs("src/lib/site-qr/scope-text.ts"),
    "@/lib/sub-portal/site-code": { isSiteOpen: p => p.status === "contracted" },
    "@/lib/supabase/server": { createClient: () => client },
  });
  const edit = { projectId: job, rosterId: roster, updatedAt: stamp, text: "Install two sinks for $900." };
  role = "field";
  assert.ok((await savePortalAssignment(edit)).error);
  role = "project_manager";
  assert.ok((await savePortalAssignment({ ...edit, text: "x".repeat(4001) })).error);
  assert.ok((await savePortalAssignment({ ...edit, text: "$800" })).error);
  assert.deepEqual(calls, []);
  assert.equal((await savePortalAssignment(edit)).error, null);
  assert.deepEqual(calls, [
    { scope_summary: "Install two sinks" }, ["id", roster], ["project_id", job], ["status", "active"], ["updated_at", stamp],
  ]);
  assert.equal((await savePortalAssignment(edit)).conflict, true);
  edited = false;
  assert.equal((await savePortalAssignment({ ...edit, text: "" })).error, null);
  assert.deepEqual(calls.at(-5), { scope_summary: null });
});

// The repo's other migration tests use the same in-memory PostgreSQL runtime.
test("Postgres guards published scope while preserving signed work-order terms and unrelated writes", async () => {
  const { PGlite } = require("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$select '${user}'::uuid$$;
      create table public.profiles(id uuid, role text);
      insert into public.profiles values ('${user}', 'field');
      create table public.sub_agreements(id uuid, number text);
      create table public.project_subcontractors(id uuid primary key, project_id uuid, subcontractor_id uuid,
        scope_summary text, status text, agreement_id uuid, contract_amount numeric, contract_locked_at timestamptz,
        pre_lock_amount numeric, pre_lock_status text, notes text);
      insert into public.project_subcontractors values ('${roster}','${job}','${user}',null,'active','${user}',1234,now(),null,null,null);
      grant usage on schema auth,public to anon,authenticated,service_role;
      grant select on public.profiles,public.sub_agreements to authenticated,service_role;
      grant select,insert,update,delete on public.project_subcontractors to authenticated,service_role;
    `);
    const previous = fs.readFileSync("supabase/migrations/20261017023947_sub_portal_v3_r1.sql", "utf8");
    const lockedTrigger = previous.slice(previous.indexOf("create or replace function public.guard_locked_sub_contract()"),
      previous.indexOf("-- Make project_subcontractors match the signed paper."));
    await db.exec(lockedTrigger);
    await db.exec(fs.readFileSync("supabase/migrations/20261117212746_guard_portal_assignment_scope.sql", "utf8"));
    await db.exec("set role authenticated");
    const put = value => db.query("update project_subcontractors set scope_summary=$1 where id=$2", [value, roster]);
    await db.exec("update project_subcontractors set notes='legacy note'");
    await assert.rejects(put("Field wrote this"), error => error.code === "42501");
    await assert.rejects(db.exec("insert into project_subcontractors(id,scope_summary) values (gen_random_uuid(),'Field wrote this')"), error => error.code === "42501");
    await db.exec("reset role; update profiles set role='project_manager'; set role authenticated");
    await put("Install blocking.");
    await assert.rejects(put("x".repeat(4001)), error => error.code === "22001");
    await assert.rejects(db.exec("update project_subcontractors set contract_amount=1235"), /Locked by/);
    assert.deepEqual((await db.query("select scope_summary, contract_amount::text from project_subcontractors")).rows[0],
      { scope_summary: "Install blocking.", contract_amount: "1234" });
    await db.exec("reset role; update profiles set role='field'; set role authenticated");
    await assert.rejects(put(null), error => error.code === "42501");
    await assert.rejects(db.exec("delete from project_subcontractors"), error => error.code === "42501");
    await db.exec("update project_subcontractors set notes='another legacy note'; reset role; set role service_role");
    await put(null);
    const second = "00000000-0000-4000-8000-000000000004";
    await db.query("insert into project_subcontractors(id, project_id, subcontractor_id, scope_summary, status) values($1,$2,$3,'Set the blocking.','active')",
      [second, job, user]);
    await db.exec("reset role; set role authenticated");
    for (const column of ["project_id", "subcontractor_id"]) {
      await assert.rejects(db.query(`update project_subcontractors set ${column}=gen_random_uuid() where id=$1`, [second]), e => e.code === "42501");
    }
    await assert.rejects(db.query("update project_subcontractors set status='removed' where id=$1", [second]), e => e.code === "42501");
    for (const role of ["owner", "precon_manager", "project_manager", "office_admin"]) {
      await db.exec("reset role");
      await db.query("update profiles set role=$1", [role]);
      await db.exec("set role authenticated");
      await put(`Instructions from ${role}`);
    }
  } finally {
    await db.close();
  }
});
