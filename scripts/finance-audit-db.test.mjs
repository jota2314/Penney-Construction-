// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite module.
// Uses an isolated in-memory PostgreSQL database; never touches Penney records.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
test("audit migration: office RLS, append-only history, concurrency and stale-source gates", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table public.profiles(id uuid primary key,role text,full_name text);
 create table public.projects(id uuid primary key);
 create table public.project_files(id uuid primary key,project_id uuid);
 create table public.job_review_runs(id uuid primary key,project_id uuid,actor_id uuid,checked_at timestamptz,snapshot jsonb,result jsonb);
 create table public.job_review_evidence(id uuid primary key,project_id uuid);
 create table public.test_snapshot(value jsonb);
 create function public.job_review_require_actor(p_actor_id uuid) returns void language plpgsql as $$begin if current_user <> 'service_role' then raise exception 'Office review access required';end if;end$$;
 create function public.job_review_snapshot(p_actor_id uuid,p_project_id uuid) returns jsonb language sql as $$select value from public.test_snapshot limit 1$$;
 grant usage on schema public,auth to authenticated,service_role,anon;
 grant select on public.profiles to authenticated;
 grant all on all tables in schema public to service_role;
 insert into public.profiles values('00000000-0000-4000-8000-000000000001','owner','Reviewer'),('00000000-0000-4000-8000-000000000002','project_manager','PM');
 insert into public.projects values('00000000-0000-4000-8000-000000000010');
 insert into public.project_files values('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010');
 insert into public.test_snapshot values('{"records":{"projects":[]}}');
 insert into public.job_review_runs values('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001',now(),'{"records":{"projects":[]}}','{"money":{"recorded_cost":60000,"contract":100000}}');`);
    await db.exec(
      fs.readFileSync(
        new URL(
          "../supabase/migrations/20261009235543_unified_finance_audit_history.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const actor = "00000000-0000-4000-8000-000000000001",
      project = "00000000-0000-4000-8000-000000000010",
      run = "00000000-0000-4000-8000-000000000030";
    const payload = {
      cost: 60000,
      contract: 100000,
      note: "Verified completed test audit",
      report_file_id: "00000000-0000-4000-8000-000000000020",
      attestation: "Reviewed",
    };
    const append = (kind, head = null, body = payload) =>
      db.query(
        "select public.append_project_finance_record($1,$2,$3,$4,$5,$6,$7,$8) id",
        [
          actor,
          project,
          kind,
          kind === "reopen" ? null : run,
          head,
          kind === "final" ? "2026-01-01" : null,
          body,
          [],
        ],
      );
    await db.exec("set role service_role");
    const id = (await append("final")).rows[0].id;
    await assert.rejects(() => append("final"), /history changed/);
    await assert.rejects(
      () =>
        db.query(
          "update public.project_finance_records set payload=$1 where id=$2",
          [{}, id],
        ),
      /permission denied|immutable/,
    );
    await assert.rejects(
      () =>
        db.query("delete from public.project_finance_records where id=$1", [
          id,
        ]),
      /permission denied|immutable/,
    );
    await db.exec(`reset role;set role authenticated;set test.uid='${actor}'`);
    assert.equal(
      (await db.query("select * from public.project_finance_records")).rows
        .length,
      1,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into public.project_finance_records(project_id) values($1)",
          [project],
        ),
      /permission denied/,
    );
    await assert.rejects(() => append("reopen", id), /permission denied/);
    await db.exec("set test.uid='00000000-0000-4000-8000-000000000002'");
    assert.equal(
      (await db.query("select * from public.project_finance_records")).rows
        .length,
      0,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      () => db.query("select * from public.project_finance_records"),
      /permission denied/,
    );
    await db.exec("reset role;set role service_role");
    const reopened = (
      await append("reopen", id, { note: "Reopen to verify a new late bill" })
    ).rows[0].id;
    assert.equal(
      (await db.query("select * from public.project_finance_records")).rows
        .length,
      2,
    );
    await db.exec(
      `update public.test_snapshot set value='{"records":{"projects":[{"id":"changed"}]}}'`,
    );
    await assert.rejects(
      () => append("forecast", reopened),
      /Source records changed/,
    );
    await db.exec(
      `update public.test_snapshot set value='{"records":{"projects":[]}}'`,
    );
    await assert.rejects(
      () => append("forecast", reopened, { ...payload, cost: 1 }),
      /P&L does not match/,
    );
    await db.exec(
      `insert into public.job_review_evidence values('00000000-0000-4000-8000-000000000040','${project}')`,
    );
    await assert.rejects(
      () => append("forecast", reopened),
      /evidence changed/,
    );
  } finally {
    await db.close();
  }
});
