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
const invoice = id => one('select *,updated_at::text stamp from client_invoices where id=$1', [id]);
const change = id => one('select *,updated_at::text stamp from change_orders where id=$1', [id]);
const history = id => db.query('select * from finance_internal.client_billing_audit where invoice_id=$1', [id]);
async function fixture() {
  const project = (await one(`insert into projects(name,contract_locked_amount,contract_value)
    values('Credit test',35500,35500) returning id`)).id;
  const bill = await one(`insert into client_invoices(project_id,invoice_number,title,amount,line_items,
    terms,status,sent_to_client_at,client_email,gmail_message_id,paid_amount,notes)
    values($1,2,'Progress Invoice',10676.67,$2,'Due on receipt','sent',
    '2026-10-01 14:00:00+00','client@example.test','original-message',0,'Original note')
    returning *,updated_at::text stamp`, [project, [
      { description: 'Progress balance', amount: 13016.67 },
      { description: 'Change Order #1, credit for owner supplied closet doors (signed 8/26)', amount: -2340 },
    ]]);
  const credit = await one(`insert into change_orders(project_id,change_order_number,title,
    status,approved_at,approved_by,cost_impact,price_impact)
    values($1,2,'Replacement closet doors','approved','2026-10-06','Client',0,-548.23)
    returning *,updated_at::text stamp`, [project]);
  await db.query(`insert into project_payment_milestones(project_id,client_invoice_id,amount,status)
    values($1,$2,10676.67,'invoiced')`, [project, bill.id]);
  return { project, bill, credit };
}
const apply = (f, overrides = {}) => {
  const p = { invoice: f.bill.id, project: f.project, invoiceStamp: f.bill.stamp,
    credit: f.credit.id, creditStamp: f.credit.stamp, reason: 'Approved replacement-door reimbursement', ...overrides };
  return one('select public.apply_client_invoice_credit($1,$2,$3,$4,$5,$6) result',
    [p.invoice,p.project,p.invoiceStamp,p.credit,p.creditStamp,p.reason]).then(row => row.result);
};
async function rejectedWithoutWrites(f, pattern, overrides) {
  const before = await invoice(f.bill.id), source = await change(f.credit.id);
  await assert.rejects(() => apply(f, overrides), pattern);
  assert.deepEqual(await invoice(f.bill.id), before);
  assert.deepEqual(await change(f.credit.id), source);
  assert.equal((await history(f.bill.id)).rows.length, 0);
}

test('approved credit appends one line, preserves issued identity and signed contract/milestone, and audits both rows', async () => {
  const f = await fixture();
  await db.exec('set role authenticated');
  let result;
  try { result = await apply(f); } finally { await db.exec('reset role'); }
  assert.equal(result.amount,10128.44);
  assert.equal(result.credit_amount,-548.23);
  assert.equal(result.already_applied,false);
  const current = await invoice(f.bill.id), source = await change(f.credit.id);
  assert.deepEqual(current.line_items.slice(0,2),f.bill.line_items);
  assert.deepEqual(current.line_items[2],{
    description:'Credit: Replacement closet doors (Change Order #2)',amount:-548.23,change_order_id:f.credit.id,
  });
  for (const key of ['id','invoice_number','title','terms','status','notes','approval_token',
    'sent_to_client_at','client_email','gmail_message_id','created_at','paid_amount']) {
    assert.deepEqual(current[key],f.bill[key],key);
  }
  assert.notEqual(current.stamp,f.bill.stamp);
  assert.equal(source.client_invoice_id,f.bill.id);
  assert.equal(source.status,'approved');
  assert.equal(Number(source.price_impact),-548.23);
  assert.equal(Number((await one('select contract_locked_amount from projects where id=$1',[f.project])).contract_locked_amount),35500);
  assert.equal(Number((await one('select amount from project_payment_milestones where client_invoice_id=$1',[f.bill.id])).amount),10676.67);
  const [audit] = (await history(f.bill.id)).rows;
  assert.equal(audit.operation,'apply_credit');
  assert.equal(audit.actor_id,owner);
  assert.equal(audit.before_record.invoice.amount,10676.67);
  assert.equal(audit.after_record.invoice.amount,10128.44);
  assert.equal(audit.before_record.change_order.client_invoice_id,null);
  assert.equal(audit.after_record.change_order.client_invoice_id,f.bill.id);
  assert.equal(audit.after_record.credit_amount,-548.23);
  assert.equal(audit.after_record.invoice.approval_token,f.bill.approval_token);
  const retry = await apply(f);
  assert.equal(retry.already_applied,true);
  assert.deepEqual(await invoice(f.bill.id),current);
  assert.equal((await history(f.bill.id)).rows.length,1);
});

test('stale invoice or credit, missing versions/reason, and foreign project are rejected atomically', async () => {
  const f = await fixture(), other = await fixture();
  for (const [overrides,pattern] of [
    [{ invoiceStamp:'2000-01-01' },/Invoice changed/],
    [{ creditStamp:'2000-01-01' },/Change order changed/],
    [{ invoiceStamp:null },/current invoice/],
    [{ creditStamp:null },/current invoice/],
    [{ reason:'' },/credit reason/],
    [{ reason:'x'.repeat(2001) },/credit reason/],
    [{ project:other.project },/this project/],
    [{ credit:other.credit.id },/this project/],
    [{ invoice:other.bill.id },/this project/],
  ]) await rejectedWithoutWrites(f,pattern,overrides);
});

test('paid, draft, void, receipt-backed and externally linked invoices cannot receive credits', async () => {
  for (const [column,value] of [
    ['status','paid'],['status','draft'],['status','void'],['paid_amount',1],
    ['paid_at','2026-10-20'],['quickbooks_invoice_id','123'],['quickbooks_id','123'],
    ['quickbooks_doc_number','INV-2'],['quickbooks_pushed_at','2026-10-20'],
  ]) {
    const f = await fixture();
    await db.query(`update client_invoices set ${column}=$2 where id=$1`,[f.bill.id,value]);
    await rejectedWithoutWrites(f,/unpaid sent invoice/);
  }
  const f = await fixture();
  await db.query('insert into payments_received(project_id,client_invoice_id,amount) values($1,$2,0)',[f.project,f.bill.id]);
  await rejectedWithoutWrites(f,/unpaid sent invoice/);
});

test('only approved negative change orders with exact cents are eligible', async () => {
  for (const [column,value] of [
    ['status','draft'],['status','submitted'],['status','rejected'],['status','void'],
    ['price_impact',0],['price_impact',548.23],['price_impact',-0.001],
    ['price_impact',null],['price_impact','NaN'],['price_impact',-100000001],
    ['title',''],['change_order_number',0],
  ]) {
    const f = await fixture();
    await db.query(`update change_orders set ${column}=$2 where id=$1`,[f.credit.id,value]);
    await rejectedWithoutWrites(f,/approved negative change order/);
  }
});

test('invalid existing lines/totals and credits that eliminate the invoice balance are rejected', async () => {
  for (const [lines,amount,pattern] of [
    [null,10676.67,/existing invoice lines/],
    [{description:'bad',amount:10676.67},10676.67,/existing invoice lines/],
    [[],0,/1 to 199/],
    [[{description:'bad',amount:'10676.67'}],10676.67,/existing invoice lines/],
    [[{description:'',amount:10676.67}],10676.67,/existing invoice lines/],
    [[{description:'bad',amount:10676.671}],10676.671,/two decimal places/],
    [[{description:'bad',amount:10676.67}],12000,/do not match/],
    [[{description:'balance',amount:548.23}],548.23,/must be positive/],
    [[{description:'balance',amount:500}],500,/must be positive/],
    [Array.from({length:200},()=>({description:'line',amount:100})),20000,/1 to 199/],
  ]) {
    const f = await fixture();
    await db.query('update client_invoices set line_items=$2,amount=$3 where id=$1',[f.bill.id,lines,amount]);
    await rejectedWithoutWrites(f,pattern);
  }
});

test('already linked and structured credits cannot be reused, including on a different project', async () => {
  let f = await fixture(), other = await fixture();
  await db.query('update change_orders set client_invoice_id=$2 where id=$1',[f.credit.id,other.bill.id]);
  await rejectedWithoutWrites(f,/already linked/);
  f = await fixture(); other = await fixture();
  await db.query('update client_invoices set line_items=$2 where id=$1',
    [other.bill.id,[{description:'Previously used',amount:-548.23,change_order_id:f.credit.id}]]);
  await rejectedWithoutWrites(f,/already included/);
});

test('legacy negative CO references block reuse but number prefixes and equal amounts do not', async () => {
  for (const description of ['CO #2 credit','Change Order #2, credit','change order 02 credit','CO2 credit']) {
    const f = await fixture();
    await db.query('update client_invoices set line_items=$2 where id=$1',
      [f.bill.id,[{description,amount:-548.23}]]);
    await rejectedWithoutWrites(f,/already referenced/);
  }
  const f = await fixture();
  await db.query('update client_invoices set line_items=$2 where id=$1',[f.bill.id,[
    {description:'Progress balance',amount:11224.90},
    {description:'Change Order #20 credit',amount:-548.23},
  ]]);
  assert.equal((await apply(f)).amount,10128.44);
});

test('audit prevents credit reuse on another invoice', async () => {
  const f = await fixture(); await apply(f);
  const second = await one(`insert into client_invoices(project_id,invoice_number,title,amount,line_items,status)
    values($1,3,'Later invoice',1000,'[{"description":"Balance","amount":1000}]','sent')
    returning *,updated_at::text stamp`,[f.project]);
  await assert.rejects(()=>apply(f,{invoice:second.id,invoiceStamp:second.stamp}),/another invoice/);
  assert.equal((await history(f.bill.id)).rows.length,1);
});

test('applied credit source billing fields and invoice identity cannot be edited or deleted', async () => {
  const f = await fixture(), other = await fixture(); await apply(f);
  for (const [column,value] of [
    ['project_id',other.project],['price_impact',-600],['status','void'],
    ['change_order_number',3],['client_invoice_id',null],['title','Changed credit'],
  ]) await assert.rejects(()=>db.query(`update change_orders set ${column}=$2 where id=$1`,
    [f.credit.id,value]),/approved billing details cannot be changed/);
  await assert.rejects(()=>db.query('delete from change_orders where id=$1',[f.credit.id]),/credit cannot be deleted/);
  await assert.rejects(()=>db.query('delete from client_invoices where id=$1',[f.bill.id]),/cannot be deleted/);
  await db.query('update change_orders set description=$2 where id=$1',[f.credit.id,'Additional evidence reference']);
  assert.equal((await change(f.credit.id)).description,'Additional evidence reference');
  // Ordinary unlinked source edits/deletes retain their existing behavior.
  await db.query('update change_orders set price_impact=-500 where id=$1',[other.credit.id]);
  await db.query('delete from change_orders where id=$1',[other.credit.id]);
});

test('the same issued invoice can receive another approved credit and then its actual receipt', async () => {
  const f = await fixture(); await apply(f);
  const second = await one(`insert into change_orders(project_id,change_order_number,title,status,price_impact)
    values($1,3,'Second approved credit','approved',-100) returning *,updated_at::text stamp`,[f.project]);
  const current = await invoice(f.bill.id);
  assert.equal((await apply(f,{invoiceStamp:current.stamp,credit:second.id,creditStamp:second.stamp})).amount,10028.44);
  const receipt = await one(`insert into payments_received(project_id,amount,review_status,received_date)
    values($1,10028.44,'ok','2026-10-21') returning id`,[f.project]);
  const payment = await one('select public.apply_client_invoice_receipt($1,$2,$3) result',
    [f.bill.id,f.project,receipt.id]);
  assert.equal(payment.result.status,'paid');
  assert.equal(Number((await invoice(f.bill.id)).paid_amount),10028.44);
  assert.equal((await apply(f)).already_applied,true);
});

test('separate estimate-line and source deletion requests both preserve an applied credit', async () => {
  const f = await fixture(), other = await fixture();
  const line = await one(`insert into estimate_line_items(change_order_id,description,total_price)
    values($1,'Replacement closet doors',-548.23) returning *`,[f.credit.id]);
  await apply(f);
  // Reproduce deleteChangeOrder: the first deletion is a separate committed
  // request, and the action attempts the second even when the first fails.
  await assert.rejects(()=>db.query('delete from estimate_line_items where change_order_id=$1',[f.credit.id]),/estimate line cannot be deleted/);
  await assert.rejects(()=>db.query('delete from change_orders where id=$1',[f.credit.id]),/credit cannot be deleted/);
  assert.deepEqual(await one('select * from estimate_line_items where id=$1',[line.id]),line);
  assert.equal((await change(f.credit.id)).client_invoice_id,f.bill.id);
  const unlinked = await one(`insert into estimate_line_items(change_order_id,description,total_price)
    values($1,'Unapplied credit',-548.23) returning id`,[other.credit.id]);
  await db.query('delete from estimate_line_items where id=$1',[unlinked.id]);
  assert.equal((await db.query('select * from estimate_line_items where id=$1',[unlinked.id])).rows.length,0);
});

test('authorization, non-public execute grants, and original draft-only restriction remain intact', async () => {
  const f = await fixture();
  for (const actor of ['',field]) {
    await db.query("select set_config('test.uid',$1,false)",[actor]);
    await rejectedWithoutWrites(f,/access to client billing/);
  }
  await db.query("select set_config('test.uid',$1,false)",[owner]);
  for (const role of ['anon','service_role']) {
    await db.exec(`set role ${role}`);
    try { await assert.rejects(()=>apply(f),/permission denied/); }
    finally { await db.exec('reset role'); }
  }
  await db.exec('set role authenticated');
  try {
    await assert.rejects(()=>db.query('select finance_internal.apply_invoice_credit($1,$2,$3,$4,$5,$6,$7)',
      [owner,f.bill.id,f.project,f.bill.stamp,f.credit.id,f.credit.stamp,'credit']),/permission denied/);
    await assert.rejects(()=>db.query('select public.revise_client_invoice($1,$2,$3,$4,$5,$6,$7)',
      [f.bill.id,f.project,f.bill.stamp,'Revised','Due',f.bill.line_items,'revision']),/unsent draft/);
  } finally { await db.exec('reset role'); }
  assert.equal((await history(f.bill.id)).rows.length,0);
});
