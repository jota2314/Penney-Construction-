import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compiled = { exports: {} };
new Function(
  "module",
  "exports",
  ts.transpileModule(readFileSync("src/lib/finance/cash-statement.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
)(compiled, compiled.exports);
const { buildCashStatement, outflowGroup } = compiled.exports;

let n = 0;
const row = (o = {}) => ({ id: `b${++n}`, txn_date: "2026-03-10", source: "eastern_ach", direction: "debit", amount: 100, ...o });
const deposit = (o = {}) => row({ source: "eastern_deposit", direction: "credit", ...o });
const build = (bank, extra = {}) => buildCashStatement({ bank, receipts: [], bills: [], today: "2026-11-05", ...extra });

test("cash in minus cash out, month by month, with a running total", () => {
  const s = build([
    deposit({ txn_date: "2026-01-05", amount: "1000.50" }),
    row({ txn_date: "2026-01-20", amount: 400, source: "eastern_check" }),
    deposit({ txn_date: "2026-02-03", amount: 300 }),
    row({ txn_date: "2026-02-10", amount: 900, description: "ADP WAGE PAY" }),
  ]);
  assert.equal(s.through, "2026-02-10");
  assert.equal(s.months.length, 2);
  assert.deepEqual(s.months.map((m) => m.net), [60050, -60000]);
  assert.deepEqual(s.months.map((m) => m.cumulative), [60050, 50]);
  assert.equal(s.totals.cashIn, 130050);
  assert.equal(s.totals.cashOut, 130000);
  assert.equal(s.totals.net, 50);
  assert.equal(s.totals.byGroup.payroll, 90000);
  assert.equal(s.totals.byGroup.subs, 40000);
});

test("a bounced client check comes off cash in, not cash out", () => {
  const s = build([
    deposit({ txn_date: "2026-09-01", amount: 8615 }),
    row({ txn_date: "2026-09-03", amount: 8615, description: "RETURN DEPOSIT ITEM DEP DATE 09/01 CHECK # 103 NSF" }),
  ]);
  assert.equal(s.totals.deposits, 861500);
  assert.equal(s.totals.returned, 861500);
  assert.equal(s.totals.cashIn, 0);
  assert.equal(s.totals.cashOut, 0);
  assert.equal(s.totals.net, 0);
});

test("card purchases are counted once — when the card is paid from checking", () => {
  const s = build([
    row({ source: "capone", amount: 750 }),
    row({ source: "capone", amount: 50, direction: "credit" }),
    row({ amount: 800, category_key: "card_payoff" }),
  ]);
  assert.equal(s.totals.cashOut, 80000);
  assert.equal(s.totals.byGroup.card, 80000);
  assert.equal(s.card.purchases, 75000);
  assert.equal(s.card.credits, 5000);
  assert.equal(s.bankCount, 1, "card statement rows are not checking transactions");
});

test("statement lines follow the bank category; checks pay subs and suppliers", () => {
  assert.equal(outflowGroup(row({ category_key: "labor" })), "payroll");
  assert.equal(outflowGroup(row({ description: "ADP Tax ADP TAX" })), "payroll");
  assert.equal(outflowGroup(row({ description: "ADPRO DESIGN" })), "other");
  assert.equal(outflowGroup(row({ source: "eastern_check" })), "subs");
  assert.equal(outflowGroup(row({ category_key: "materials" })), "subs");
  assert.equal(outflowGroup(row({ category_key: "insurance" })), "insurance");
  assert.equal(outflowGroup(row({ category_key: "fuel" })), "vehicles");
  assert.equal(outflowGroup(row({ category_key: "licenses" })), "permits");
  assert.equal(outflowGroup(row({ category_key: "software" })), "office");
  assert.equal(outflowGroup(row({})), "other");
});

test("the same imported transaction counts once; other years and future dates are ignored", () => {
  const dup = deposit({ id: "same", amount: 500 });
  const s = build([dup, { ...dup }, deposit({ txn_date: "2025-12-31", amount: 999 }), deposit({ txn_date: "2026-11-30", amount: 999 })]);
  assert.equal(s.totals.cashIn, 50000);
  assert.equal(s.bankCount, 1);
});

test("a month with no statement imported is reported as a gap, never silently zero", () => {
  const s = build([deposit({ txn_date: "2026-01-05" }), deposit({ txn_date: "2026-03-05" })]);
  assert.deepEqual(s.gaps, ["2026-02"]);
  assert.equal(s.months.length, 3);
});

test("after the last statement, app records stand in — payroll and in-house labor excluded, cards separate", () => {
  const bank = [deposit({ txn_date: "2026-10-31", amount: 1 })];
  const receipts = [
    { received_date: "2026-10-31", amount: 999 }, // inside the statement — bank already has it
    { received_date: "2026-11-02", amount: 5000 },
    { received_date: "2026-11-04", amount: "250.25" },
  ];
  const bill = (o) => ({ invoice_date: "2026-11-03", paid_date: null, amount: 100, paid_amount: 0, payment_status: "paid", payment_method: "check", vendor_name: "Sub", ...o });
  const bills = [
    bill({}),
    bill({ paid_amount: 60, amount: 100 }),
    bill({ payment_method: "capital_one", amount: 40 }),
    bill({ vendor_name: "In-House Labor", amount: 5000 }),
    bill({ vendor_name: "ADP Payroll", amount: 5000 }),
    bill({ payment_status: "unpaid" }),
    bill({ payment_method: "internal" }),
    bill({ duplicate_of_id: "x" }),
    bill({ invoice_date: "2026-10-30" }),
    bill({ invoice_date: "2026-10-30", paid_date: "2026-11-01", amount: 7 }),
  ];
  const s = build(bank, { receipts, bills });
  assert.equal(s.after.from, "2026-11-01");
  assert.equal(s.after.receipts, 525025);
  assert.equal(s.after.receiptCount, 2);
  assert.equal(s.after.billsPaid, 10000 + 6000 + 700);
  assert.equal(s.after.billCount, 3);
  assert.equal(s.after.cardPurchases, 4000);
  assert.equal(s.months[9].recordedReceipts, 99900);
});

test("no statements imported: no totals claimed, and app records cover the whole year", () => {
  const s = build([], { receipts: [{ received_date: "2026-02-01", amount: 10 }] });
  assert.equal(s.through, null);
  assert.equal(s.months.length, 0);
  assert.equal(s.after.from, "2026-01-01");
  assert.equal(s.after.receipts, 1000);
});

test("an unreadable bank amount fails loudly instead of under-reporting", () => {
  assert.throws(() => build([deposit({ amount: "abc" })]), /no readable amount/);
});

test("matched share comes from the bank's match status", () => {
  const s = build([
    deposit({ match_status: "matched" }),
    deposit({ match_status: "no_invoice_expected" }),
    row({ match_status: "unmatched", amount: 250 }),
  ]);
  assert.deepEqual(s.reconciliation, { total: 3, matched: 2, open: 1, openAmount: 25000 });
});
