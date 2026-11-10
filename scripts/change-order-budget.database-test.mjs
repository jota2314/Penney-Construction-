import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../penney-mcp/package.json", import.meta.url));
const { PGlite } = require("@electric-sql/pglite");
const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const db = new PGlite();
const actor = "00000000-0000-4000-8000-000000000001";
const job = "00000000-0000-4000-8000-000000000002";
const estimate = "00000000-0000-4000-8000-000000000003";
const co = "00000000-0000-4000-8000-000000000004";
const line = "00000000-0000-4000-8000-000000000005";
const request = "00000000-0000-4000-8000-000000000006";
const reason = "Verified the signed PDF and source bills; restore the agreed budget to its tracking line.";
const refs = [`change_orders:${co}`, `estimate_line_items:${line}`, "project-files:signed.pdf#sha256=test-fixture"];
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
create table public.profiles(id uuid primary key,role text);
create table public.projects(id uuid primary key,contract_locked_at timestamptz,contract_locked_amount numeric,
 contract_value numeric,contract_signed_pdf_path text,estimated_value numeric,status text,updated_at timestamptz);
create table public.estimates(id uuid primary key,project_id uuid references projects(id),status text,
 total_cost numeric,total_price numeric,total_profit numeric,markup_pct numeric,updated_at timestamptz);
create table public.change_orders(id uuid primary key,project_id uuid references projects(id),estimate_id uuid references estimates(id),
 change_order_number integer,title text,description text,status text,cost_impact numeric,price_impact numeric,
 client_signed_at timestamptz,client_signature text,notes text,updated_at timestamptz);
create table public.estimate_line_items(id uuid primary key,estimate_id uuid references estimates(id),change_order_id uuid references change_orders(id),
 description text,cost numeric,total_cost numeric,unit_cost numeric,client_price numeric,total_price numeric,profit numeric,
 markup_pct numeric,markup_percentage numeric,quantity numeric,is_section_header boolean default false,is_locked boolean default false,
 notes text,scope_text text,unit text,updated_at timestamptz);
create table public.project_finance_records(id uuid primary key,project_id uuid,kind text,created_at timestamptz);
create table public.invoices(id uuid primary key,project_id uuid,estimate_line_item_id uuid,amount numeric,paid_amount numeric);
create table public.payments_received(id uuid primary key,project_id uuid,amount numeric);
create function public.current_estimate_id(uuid) returns uuid language sql as $$select id from public.estimates where project_id=$1 limit 1$$;
create function public.job_review_require_actor(uuid) returns void language plpgsql as $$begin
 if auth.role() is distinct from 'service_role' or not exists(select 1 from public.profiles where id=$1 and role in ('owner','office_admin','precon_manager')) then
 raise exception 'Office review access required' using errcode='42501'; end if; end;$$;
`);
// Exercise the real dual-column/header rollup and frozen-contract triggers.
await db.exec(read("../supabase/migrations/00086_estimate_totals_dual_column_sync.sql"));
await db.exec("create trigger estimate_line_items_sync_totals after insert or update or delete on estimate_line_items for each row execute function sync_estimate_totals_from_lines();");
const contractMigration = read("../supabase/migrations/00107_contract_signing.sql");
await db.exec(contractMigration.slice(contractMigration.indexOf("create or replace function sync_project_value_from_estimate()"), contractMigration.indexOf("comment on column projects.contract_locked_amount")));
await db.exec("create trigger estimate_project_sync after update on estimates for each row execute function sync_project_value_from_estimate();");
await db.exec(read("../supabase/migrations/20261110162433_reconcile_signed_change_order_budget.sql"));

async function reset() {
  await db.exec(`truncate change_order_budget_reconciliations,project_finance_records,invoices,payments_received,estimate_line_items,change_orders,estimates,projects,profiles cascade;
    select set_config('request.jwt.claim.role','service_role',false);
    insert into profiles values('${actor}','owner');
    insert into projects values('${job}','2026-09-01',262351.66,262351.66,'signed-contract.pdf',262351.66,'in_progress',now());
    insert into estimates(id,project_id,status) values('${estimate}','${job}','accepted');
    insert into change_orders values('${co}','${job}','${estimate}',9,'Sonotubes — Excavation & Installation Labor','Signed scope','approved',605.34,655.34,'2026-09-12','signature-fixture','Signed CO notes',now());
    insert into estimate_line_items(id,estimate_id,change_order_id,description,cost,total_cost,unit_cost,client_price,total_price,profit,markup_pct,markup_percentage,quantity,notes,scope_text,unit,updated_at)
      values('${line}','${estimate}','${co}','Sonotubes (CO, unpriced)',0,0,0,0,0,0,0,0,1,'Pricing pending','Original tracking scope','LS',now());
    insert into invoices values(gen_random_uuid(),'${job}','${line}',300,300);
    insert into payments_received values(gen_random_uuid(),'${job}',5000);`);
}
const query = async (sql, values=[]) => (await db.query(sql, values)).rows;
const row = async table => (await query(`select to_jsonb(t) r from ${table} t limit 1`))[0]?.r;
const preview = async () => (await query("select reconcile_signed_change_order_budget($1,$2,$3,$4) r", [actor,job,co,line]))[0].r;
const apply = async (p, overrides={}) => {
  const args={actor,job,co,line,request,coHash:p.expected_change_order_fingerprint,lineHash:p.expected_line_fingerprint,reason,refs,...overrides};
  return (await query("select reconcile_signed_change_order_budget($1,$2,$3,$4,true,$5,$6,$7,$8,$9) r", [args.actor,args.job,args.co,args.line,args.request,args.coHash,args.lineHash,args.reason,args.refs]))[0].r;
};

test("preview is read-only and apply updates only the exact tracking line with immutable audit and idempotent retry", async () => {
  await reset();
  const before={line:await row("estimate_line_items"),co:await row("change_orders"),bill:await row("invoices"),payment:await row("payments_received")};
  const p=await preview();
  assert.equal(p.applied,false);
  assert.equal(p.proposed_line.client_price,655.34);
  assert.deepEqual(await row("estimate_line_items"),before.line);
  assert.equal((await query("select * from change_order_budget_reconciliations")).length,0);
  const applied=await apply(p);
  assert.equal(applied.applied,true);
  assert.equal(applied.audit_id,request);
  const after=await row("estimate_line_items");
  assert.equal(after.cost,605.34); assert.equal(after.total_cost,605.34);
  assert.equal(after.client_price,655.34); assert.equal(after.total_price,655.34); assert.equal(after.profit,50);
  assert.equal(after.description,"Sonotubes — Excavation & Installation Labor");
  assert.equal(after.scope_text,before.line.scope_text); assert.equal(after.quantity,1);
  assert.match(after.notes,/Budget reconciled to signed CO #9/);
  assert.deepEqual(await row("change_orders"),before.co);
  assert.deepEqual(await row("invoices"),before.bill);
  assert.deepEqual(await row("payments_received"),before.payment);
  assert.equal((await row("projects")).contract_value,262351.66);
  assert.equal((await row("projects")).contract_locked_amount,262351.66);
  assert.equal((await row("estimates")).total_price,655.34);
  const audit=await row("change_order_budget_reconciliations");
  assert.deepEqual(audit.before_line,before.line); assert.deepEqual(audit.after_line,after); assert.deepEqual(audit.source_change_order,before.co);
  assert.equal((await apply(p)).already_applied,true);
  assert.equal((await query("select * from change_order_budget_reconciliations")).length,1);
  await assert.rejects(()=>apply(p,{reason:"A different request must not reuse the same saved identifier."}),/different reconciliation/);
  await assert.rejects(()=>db.exec("update change_order_budget_reconciliations set reason='bad'"),/immutable/);
  await assert.rejects(()=>db.exec("delete from change_order_budget_reconciliations"),/immutable/);
});

test("stale CO and line changes block writes, including old-dated edits", async () => {
  await reset(); let p=await preview();
  await db.exec("update change_orders set price_impact=656.34");
  await assert.rejects(()=>apply(p),/changed after preview/);
  assert.equal((await row("estimate_line_items")).client_price,0);
  p=await preview(); await db.exec("update estimate_line_items set notes='A new field finding'");
  await assert.rejects(()=>apply(p),/changed after preview/);
  assert.equal((await query("select * from change_order_budget_reconciliations")).length,0);
});

test("reject wrong IDs, duplicate links, multi-quantity lines, locks, unsigned COs, final audit and unlocked contracts", async () => {
  const checks=[
    ["update estimate_line_items set quantity=2",/quantity 1/],
    ["update estimate_line_items set is_locked=true",/locked budget line/],
    ["update change_orders set client_signed_at=null,client_signature=null",/client-signed/],
    ["update change_orders set status='submitted'",/client-signed/],
    ["update projects set contract_locked_at=null",/contract must be locked/],
    ["insert into project_finance_records values(gen_random_uuid(),'"+job+"','final',now())",/Reopen the final/],
    ["insert into project_finance_records values(gen_random_uuid(),'"+job+"','final',now()-interval '1 day'),(gen_random_uuid(),'"+job+"','forecast',now())",/Reopen the final/],
    ["insert into estimate_line_items(id,estimate_id,change_order_id,quantity) values(gen_random_uuid(),'"+estimate+"','"+co+"',1)",/exactly one/],
  ];
  for(const [sql,pattern] of checks){ await reset(); await db.exec(sql); await assert.rejects(preview,pattern); }
  await reset();
  await assert.rejects(()=>query("select reconcile_signed_change_order_budget($1,$2,$3,$4)",[actor,job,co,request]),/Exact linked budget line/);
  await assert.rejects(()=>query("select reconcile_signed_change_order_budget($1,$2,$3,$4)",[actor,job,request,line]),/does not belong/);
});

test("office/service access, request metadata and evidence are required", async () => {
  await reset(); const p=await preview();
  await assert.rejects(()=>apply(p,{reason:"short"}),/reason and inspected evidence/);
  await assert.rejects(()=>apply(p,{refs:[]}),/reason and inspected evidence/);
  await assert.rejects(()=>apply(p,{request:null}),/reason and inspected evidence/);
  await db.exec("update profiles set role='field'"); await assert.rejects(preview,/Office review access/);
  await db.exec("update profiles set role='owner'; select set_config('request.jwt.claim.role','authenticated',false)");
  await assert.rejects(preview,/Office review access/);
  const acl=await query("select has_function_privilege('anon','public.reconcile_signed_change_order_budget(uuid,uuid,uuid,uuid,boolean,uuid,text,text,text,text[])','execute') anon,has_function_privilege('authenticated','public.reconcile_signed_change_order_budget(uuid,uuid,uuid,uuid,boolean,uuid,text,text,text,text[])','execute') authenticated,has_table_privilege('service_role','change_order_budget_reconciliations','update') can_update");
  assert.deepEqual(acl[0],{anon:false,authenticated:false,can_update:false});
});

test("a trigger attempting to change signed terms rolls the whole repair back", async () => {
  await reset(); const p=await preview();
  await db.exec(`create function corrupt_signed_terms() returns trigger language plpgsql as $$begin update change_orders set price_impact=1; return new; end;$$;
    create trigger corrupt_signed_terms after update on estimate_line_items for each row execute function corrupt_signed_terms();`);
  await assert.rejects(()=>apply(p),/Signed change order changed/);
  assert.equal((await row("estimate_line_items")).client_price,0);
  assert.equal((await row("change_orders")).price_impact,655.34);
  assert.equal((await query("select * from change_order_budget_reconciliations")).length,0);
  await db.exec("drop trigger corrupt_signed_terms on estimate_line_items");
});

test("database closed",async()=>{await db.close();});
