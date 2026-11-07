import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const src = fs.readFileSync(new URL("../src/lib/finance/amount-due.ts", import.meta.url), "utf8");
const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { pickBillAmount, dueFromText } = await import(`data:text/javascript;base64,${Buffer.from(out).toString("base64")}`);

// The totals block of DL Services' real Housecall Pro invoices, as the scanner read them.
const dl = (job, due, history) =>
  `Subtotal $${job}\nTotal Tax $0.00\nSales tax (6.25%) (6.25%) $0.00\nJob Total $${job}\nInvoice Amount $${due}\nPayment History\n${history}\nThank you for your business!`;
const DL_6701 = dl("21,550.00", "14,000.00", "Jun 24 Wed 8:38am Bank Account $1,000.00");
const DL_6704 = dl("38,250.00", "5,000.00", "Sep 01 Tue 7:01pm Check $1,000.00");
const DL_6648 = dl("14,850.00", "7,425.00", "Sep 12 Sat 9:13am Check $10,225.00");

test("DL 6701 Ouellette files the $14,000 it asks for, not the $21,550 job total", () => {
  const pick = pickBillAmount({ total: 21550, balanceDue: 14000, extractedText: DL_6701 });
  assert.equal(pick.amount, 14000);
  assert.equal(pick.jobTotal, 21550);
  assert.match(pick.reason, /\$21,550\.00/);
  assert.match(pick.reason, /\$14,000\.00/);
});

test("the other two DL draws match what Ryan corrected them to by hand", () => {
  assert.equal(pickBillAmount({ total: 38250, balanceDue: 5000, extractedText: DL_6704 }).amount, 5000);
  assert.equal(pickBillAmount({ total: 14850, balanceDue: 7425, extractedText: DL_6648 }).amount, 7425);
});

test("when the model leaves balance_due empty, the printed Invoice Amount still wins", () => {
  assert.equal(dueFromText(DL_6701), 14000);
  const pick = pickBillAmount({ total: 21550, balanceDue: null, extractedText: DL_6701 });
  assert.equal(pick.amount, 14000);
  assert.equal(pick.jobTotal, 21550);
});

test("a DL invoice for the whole job (Invoice Amount = Job Total) keeps the total", () => {
  const text = dl("4,250.00", "4,250.00", "");
  const pick = pickBillAmount({ total: 4250, balanceDue: 4250, extractedText: text });
  assert.deepEqual(pick, { amount: 4250, jobTotal: null, reason: null });
});

test("a paid receipt (Balance Due $0.00) keeps its total, as before", () => {
  const text = "HOME DEPOT\nSUBTOTAL 312.40\nSALES TAX 19.53\nTOTAL $331.93\nVISA PAYMENT 331.93\nBalance Due $0.00";
  assert.equal(pickBillAmount({ total: 331.93, balanceDue: 0, extractedText: text }).amount, 331.93);
  // A PAID stamp also keeps the total, even if a stray due figure is read.
  assert.equal(pickBillAmount({ total: 900, balanceDue: 400, paidStamp: true, extractedText: "Job Total $900.00\nAmount Due $400.00" }).amount, 900);
});

test("an early-pay discount is not a draw: the Peabody light bill keeps $78.25", () => {
  const text = [
    "Total Amount Due: 78.25. Discounted Net Due Date: 10/30/2026. Discounted Net Due Amt: 64.86. Amount Paid.",
    "Previous Amount Due 73.25; Payment(s) -73.25.",
    "Total Current Charges 78.25. Total Amount Due 78.25.",
    "Discounted Net Amount Due 64.86",
  ].join("\n");
  assert.equal(pickBillAmount({ total: 78.25, balanceDue: 64.86, extractedText: text }).amount, 78.25);
  assert.equal(pickBillAmount({ total: 78.25, balanceDue: null, extractedText: text }).amount, 78.25);
});

test("a lower amount due with no sign of earlier payments keeps the total", () => {
  const text = "Framing labor 40 hrs\nTotal $3,200.00\nAmount Due $1,600.00";
  assert.equal(pickBillAmount({ total: 3200, balanceDue: 1600, extractedText: text }).amount, 3200);
});

test("other progress wording: less previous payments, paid to date, deposit received", () => {
  const cases = [
    "Contract Amount $50,000.00\nLess Previous Payments $30,000.00\nBalance Due $20,000.00",
    "Total $12,000.00\nPaid to Date $4,000.00\nAmount Due $8,000.00",
    "Total $6,000.00\nDeposit Received $2,000.00\nBalance Due $4,000.00",
  ];
  const totals = [50000, 12000, 6000];
  const dues = [20000, 8000, 4000];
  cases.forEach((text, i) => assert.equal(pickBillAmount({ total: totals[i], balanceDue: null, extractedText: text }).amount, dues[i]));
});

test("credits and unreadable totals are left alone", () => {
  assert.equal(pickBillAmount({ total: 42.5, balanceDue: 10, isCredit: true, extractedText: DL_6701 }).amount, 42.5);
  assert.equal(pickBillAmount({ total: null, balanceDue: 14000, extractedText: DL_6701 }).amount, null);
});
