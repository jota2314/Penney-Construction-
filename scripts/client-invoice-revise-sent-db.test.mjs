// Run with PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js.
// All mutations occur in an isolated in-memory PostgreSQL database.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE
  ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
await db.exec(read('./client-invoice-credit-test-schema.sql'));
await db.exec(read('../supabase/migrations/20261001005249_mcp_client_finance.sql'));
await db.exec(read('../supabase/migrations/20261021203124_apply_approved_client_invoice_credit.sql'));
after(() => db.close());
const owner = '00000000-0000-4000-8000-000000000001';
const field = '00000000-0000-4000-8000-000000000002';
await db.exec(`insert into profiles values('${owner}','owner'),('${field}','field');
  set test.uid='${owner}';set test.role='authenticated';`);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

// Invoices corrected by hand before this workflow (Jackling #5, 11/3/26) must
// come out of the migration flagged when they have a QuickBooks copy.
const legacyProject = (await one(`insert into projects(name) values('Legacy fix') returning id`)).id;
const legacyLinked = (await one(`insert into client_invoices(project_id,invoice_number,title,amount,line_items,status,
  sent_to_client_at,quickbooks_invoice_id,quickbooks_doc_number) values($1,5,'Change orders',15403.03,'[]','sent',now(),'9803','TEST-5')
  returning id`, [legacyProject])).id;
const legacyUnlinked = (await one(`insert into client_invoices(project_id,invoice_number,title,amount,line_items,status,sent_to_client_at)
  values($1,6,'Unlinked',100,'[]','sent',now()) returning id`, [legacyProject])).id;
for (const id of [legacyLinked, legacyUnlinked]) {
  await db.query(`insert into finance_internal.client_billing_audit(actor_id,project_id,invoice_id,operation,reason,before_record,after_record,created_at)
    values($1,$2,$3,'revise_sent','Manual correction','{}','{}','2026-11-03 13:41:28+00')`, [owner, legacyProject, id]);
}
await db.exec(read('../supabase/migrations/20261103150000_revise_sent_client_invoice_in_place.sql'));

const invoice = id => one('select *,updated_at::text stamp from client_invoices where id=$1', [id]);
const history = id => db.query('select * from finance_internal.client_billing_audit where invoice_id=$1 order by id', [id]);
const lines = [
  { description: 'Change Order #1, additional work', amount: 13199 },
  { description: 'Change Order #2, mechanical allowance', amount: 2000 },
];
async function fixture(overrides = {}) {
  const project = (await one(`insert into projects(name,contract_locked_amount,contract_value)
    values('Revise test',50000,50000) returning id`)).id;
  const v = { status: 'sent', sent: '2026-10-20 12:39:49+00', qbId: null, qbDoc: null, description: 'Approved change orders.', ...overrides };
  const bill = await one(`insert into client_invoices(project_id,invoice_number,title,description,amount,line_items,
    terms,status,sent_to_client_at,client_email,gmail_message_id,notes,invoice_date,quickbooks_invoice_id,quickbooks_doc_number)
    values($1,5,'Change orders',$2,15199,$3,'Due on receipt',$4,$5,'client@example.test','original-message','Original note',
    '2026-10-20',$6,$7) returning *,updated_at::text stamp`,
    [project, v.description, lines, v.status, v.sent, v.qbId, v.qbDoc]);
  await db.query(`insert into project_payment_milestones(project_id,client_invoice_id,amount,status)
    values($1,$2,15199,'invoiced')`, [project, bill.id]);
  return { project, bill };
}
const revise = (f, overrides = {}) => {
  const p = { stamp: f.bill.stamp, title: 'Change orders', terms: 'Due on receipt', reason: 'Jorge: credit door items removed from scope',
    lines: [...lines, { description: 'Credit: door items removed from scope', amount: -4509 }], description: undefined, ...overrides };
  return one('select public.revise_client_invoice($1,$2,$3,$4,$5,$6,$7,$8) result',
    [f.bill.id, f.project, p.stamp, p.title, p.terms, JSON.stringify(p.lines), p.reason, p.description ?? null]).then(r => r.result);
};
async function rejectedWithoutWrites(f, pattern, overrides) {
  const before = await invoice(f.bill.id);
  const audits = (await history(f.bill.id)).rows.length;
  await assert.rejects(() => revise(f, overrides), pattern);
  assert.deepEqual(await invoice(f.bill.id), before);
  assert.equal((await history(f.bill.id)).rows.length, audits);
}

test('a sent QuickBooks-linked invoice is corrected in place, audited as revise_sent and flagged, never reissued', async () => {
  const f = await fixture({ qbId: '9803', qbDoc: 'PC-2026-099-5' });
  const result = await revise(f, { description: 'Approved change orders, less the door credit.' });
  assert.equal(result.id, f.bill.id);
  assert.equal(result.invoice_number, 5);
  assert.equal(result.status, 'sent');
  assert.equal(result.amount, 10690);
  assert.equal(result.operation, 'revise_sent');
  assert.match(result.quickbooks_note, /PC-2026-099-5 still shows the old invoice/);
  const current = await invoice(f.bill.id);
  for (const key of ['id', 'invoice_number', 'invoice_date', 'status', 'sent_to_client_at', 'approval_token', 'client_email',
    'gmail_message_id', 'notes', 'created_at', 'quickbooks_invoice_id', 'quickbooks_doc_number', 'paid_amount', 'paid_at']) {
    assert.deepEqual(current[key], f.bill[key], key);
  }
  assert.equal(Number(current.amount), 10690);
  assert.equal(current.line_items.at(-1).amount, -4509);
  assert.equal(current.description, 'Approved change orders, less the door credit.');
  assert.ok(current.quickbooks_out_of_date_at);
  assert.equal(current.quickbooks_out_of_date_at.getTime(), current.updated_at.getTime());
  assert.equal(Number((await one('select amount from project_payment_milestones where client_invoice_id=$1', [f.bill.id])).amount), 15199);
  assert.equal((await one('select count(*)::int n from client_invoices where project_id=$1', [f.project])).n, 1);
  const [audit] = (await history(f.bill.id)).rows;
  assert.equal(audit.operation, 'revise_sent');
  assert.equal(audit.actor_id, owner);
  assert.equal(audit.reason, 'Jorge: credit door items removed from scope');
  for (const key of ['amount', 'line_items', 'description', 'notes', 'updated_at', 'title', 'terms', 'invoice_number', 'invoice_date', 'status']) {
    assert.ok(key in audit.before_record && key in audit.after_record, key);
  }
  assert.equal(audit.before_record.amount, 15199);
  assert.equal(audit.after_record.amount, 10690);
  assert.equal(audit.before_record.description, 'Approved change orders.');
  assert.equal(audit.before_record.quickbooks_out_of_date_at, null);
  assert.ok(audit.after_record.quickbooks_out_of_date_at);
});

test('a sent invoice without a QuickBooks copy is revised without a flag; drafts keep revise_draft', async () => {
  const sent = await fixture();
  const result = await revise(sent);
  assert.equal(result.operation, 'revise_sent');
  assert.equal(result.quickbooks_note, null);
  assert.equal((await invoice(sent.bill.id)).quickbooks_out_of_date_at, null);
  const draft = await fixture({ status: 'draft', sent: null });
  assert.equal((await revise(draft)).operation, 'revise_draft');
  assert.equal((await history(draft.bill.id)).rows[0].operation, 'revise_draft');
  // A draft that was emailed is a correction of record too.
  const emailedDraft = await fixture({ status: 'draft' });
  assert.equal((await revise(emailedDraft)).operation, 'revise_sent');
});

test('description: omitted keeps it, blank clears it', async () => {
  const f = await fixture();
  await revise(f);
  let current = await invoice(f.bill.id);
  assert.equal(current.description, 'Approved change orders.');
  await revise(f, { stamp: current.stamp, description: '   ' });
  current = await invoice(f.bill.id);
  assert.equal(current.description, null);
});

test('paid, partially paid, receipt-backed and void invoices stay refused', async () => {
  for (const [column, value, pattern] of [
    ['status', 'paid', /paid invoice/], ['paid_amount', 1, /paid invoice/], ['paid_at', '2026-10-25', /paid invoice/],
    ['status', 'void', /draft or sent/],
  ]) {
    const f = await fixture({ qbId: '1', qbDoc: 'X-1' });
    await db.query(`update client_invoices set ${column}=$2 where id=$1`, [f.bill.id, value]);
    f.bill = await invoice(f.bill.id);
    await rejectedWithoutWrites(f, pattern);
  }
  const f = await fixture();
  await db.query('insert into payments_received(project_id,client_invoice_id,amount) values($1,$2,0)', [f.project, f.bill.id]);
  await rejectedWithoutWrites(f, /applied receipts/);
});

test('stale versions, bad lines, fractional cents, non-positive totals and missing reasons are rejected atomically', async () => {
  const f = await fixture({ qbId: '1' });
  for (const [overrides, pattern] of [
    [{ stamp: '2000-01-01' }, /Invoice changed/],
    [{ reason: ' ' }, /reason/],
    [{ lines: [{ description: 'x', amount: 1.001 }] }, /two decimal/],
    [{ lines: [{ description: 'x', amount: 100 }, { description: 'credit', amount: -100 }] }, /positive/],
    [{ lines: [{ description: 'x', amount: 100, extra: true }] }, /Invalid invoice line/],
    [{ lines: [{ description: 'x', amount: 100, change_order_id: 'not-a-uuid' }] }, /Invalid invoice line/],
    [{ description: 'x'.repeat(4001) }, /description/],
  ]) await rejectedWithoutWrites(f, pattern, overrides);
  assert.equal((await invoice(f.bill.id)).quickbooks_out_of_date_at, null);
});

test('applied change order credits keep their line and amount; new links only come from the credit workflow', async () => {
  const f = await fixture();
  const credit = await one(`insert into change_orders(project_id,change_order_number,title,status,price_impact)
    values($1,7,'Closet doors credit','approved',-548.23) returning *,updated_at::text stamp`, [f.project]);
  await one('select public.apply_client_invoice_credit($1,$2,$3,$4,$5,$6) result',
    [f.bill.id, f.project, f.bill.stamp, credit.id, credit.stamp, 'Approved reimbursement']);
  f.bill = await invoice(f.bill.id);
  const creditLine = f.bill.line_items.at(-1);
  assert.equal(creditLine.change_order_id, credit.id);
  await rejectedWithoutWrites(f, /Keep each applied change order credit/, { lines });
  await rejectedWithoutWrites(f, /Keep each applied change order credit/,
    { lines: [...lines, { ...creditLine, amount: -500 }] });
  await rejectedWithoutWrites(f, /credit workflow/,
    { lines: [...lines, creditLine, { description: 'Fake link', amount: -1, change_order_id: f.project }] });
  await rejectedWithoutWrites(f, /credit workflow/, { lines: [...lines, creditLine, creditLine] });
  const kept = await revise(f, { lines: [...lines, { ...creditLine, description: 'Credit: replacement closet doors' },
    { description: 'Credit: door items removed from scope', amount: -4509 }] });
  assert.equal(kept.amount, 10141.77);
  assert.equal((await invoice(f.bill.id)).line_items[2].change_order_id, credit.id);
});

test('a no-op save on a linked invoice is audited but does not flag QuickBooks', async () => {
  const f = await fixture({ qbId: '1' });
  await revise(f, { lines });
  assert.equal((await invoice(f.bill.id)).quickbooks_out_of_date_at, null);
  assert.equal((await history(f.bill.id)).rows.length, 1);
});

test('the QuickBooks flag clears only for the revision the user saw, is audited, and returns on the next revision', async () => {
  const f = await fixture({ qbId: '9803', qbDoc: 'PC-2026-099-5' });
  await revise(f);
  let current = await invoice(f.bill.id);
  const seen = current.quickbooks_out_of_date_at.toISOString();
  await assert.rejects(() => db.query('select public.mark_client_invoice_quickbooks_current($1,$2,$3)',
    [f.bill.id, f.project, '2000-01-01']), /revised again/);
  await db.query("select set_config('test.uid',$1,false)", [field]);
  await assert.rejects(() => db.query('select public.mark_client_invoice_quickbooks_current($1,$2,$3)',
    [f.bill.id, f.project, seen]), /access to client billing/);
  await db.query("select set_config('test.uid',$1,false)", [owner]);
  await db.query('select public.mark_client_invoice_quickbooks_current($1,$2,$3)', [f.bill.id, f.project, seen]);
  const cleared = await invoice(f.bill.id);
  assert.equal(cleared.quickbooks_out_of_date_at, null);
  assert.equal(cleared.stamp, current.stamp);
  const audits = (await history(f.bill.id)).rows;
  assert.equal(audits.at(-1).operation, 'quickbooks_marked_current');
  assert.equal(audits.at(-1).before_record.quickbooks_doc_number, 'PC-2026-099-5');
  assert.equal((await one('select public.mark_client_invoice_quickbooks_current($1,$2,$3) r', [f.bill.id, f.project, seen])).r.already_current, true);
  await revise(f, { stamp: cleared.stamp, title: 'Change orders, corrected' });
  current = await invoice(f.bill.id);
  assert.ok(current.quickbooks_out_of_date_at);
});

test('MCP wrapper shares the workflow and needs the trusted service; grants stay private', async () => {
  const f = await fixture({ qbId: '1' });
  const call = () => db.query('select public.mcp_revise_client_invoice($1,$2,$3,$4,$5,$6,$7,$8,$9) r',
    [owner, f.bill.id, f.project, f.bill.stamp, 'Change orders', 'Due on receipt',
      JSON.stringify([...lines, { description: 'Credit', amount: -199 }]), 'MCP correction', 'New description']);
  await assert.rejects(call, /Trusted MCP/);
  await db.query("select set_config('test.role','service_role',false)");
  try {
    const r = (await call()).rows[0].r;
    assert.equal(r.operation, 'revise_sent');
    assert.equal(r.amount, 15000);
    assert.equal((await invoice(f.bill.id)).description, 'New description');
  } finally { await db.query("select set_config('test.role','authenticated',false)"); }
  const sig = 'uuid,uuid,timestamptz,text,text,jsonb,text,text';
  const grants = await one(`select
    has_function_privilege('authenticated','public.revise_client_invoice(${sig})','execute') app_auth,
    has_function_privilege('anon','public.revise_client_invoice(${sig})','execute') app_anon,
    has_function_privilege('service_role','public.revise_client_invoice(${sig})','execute') app_service,
    has_function_privilege('authenticated','public.mcp_revise_client_invoice(uuid,${sig})','execute') mcp_auth,
    has_function_privilege('service_role','public.mcp_revise_client_invoice(uuid,${sig})','execute') mcp_service,
    has_function_privilege('authenticated','public.mark_client_invoice_quickbooks_current(uuid,uuid,timestamptz)','execute') mark_auth,
    has_function_privilege('anon','public.mark_client_invoice_quickbooks_current(uuid,uuid,timestamptz)','execute') mark_anon,
    has_function_privilege('authenticated','finance_internal.revise_invoice(uuid,uuid,uuid,timestamptz,text,text,jsonb,text,text)','execute') internal`);
  assert.deepEqual(grants, { app_auth: true, app_anon: false, app_service: false, mcp_auth: false, mcp_service: true,
    mark_auth: true, mark_anon: false, internal: false });
  assert.equal((await one(`select count(*)::int n from pg_proc where proname in ('revise_client_invoice','mcp_revise_client_invoice')`)).n, 2);
});

test('billing read exposes the description, issue date and stale QuickBooks flag', async () => {
  const f = await fixture({ qbId: '1', qbDoc: 'PC-1-5' });
  await revise(f);
  await db.query("select set_config('test.role','service_role',false)");
  try {
    const r = (await one('select public.mcp_get_client_billing($1,$2) r', [owner, f.project])).r;
    const [inv] = r.invoices;
    assert.equal(inv.description, 'Approved change orders.');
    assert.equal(inv.invoice_date, '2026-10-20');
    assert.equal(inv.quickbooks_doc_number, 'PC-1-5');
    assert.ok(inv.quickbooks_out_of_date_at);
    assert.equal(r.history[0].operation, 'revise_sent');
  } finally { await db.query("select set_config('test.role','authenticated',false)"); }
});

test('migration flags invoices already corrected by hand only when they have a QuickBooks copy', async () => {
  assert.equal((await invoice(legacyLinked)).quickbooks_out_of_date_at.toISOString(), '2026-11-03T13:41:28.000Z');
  assert.equal((await invoice(legacyUnlinked)).quickbooks_out_of_date_at, null);
});
