import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const url = (path, swap = {}) => {
  let src = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  for (const [from, to] of Object.entries(swap)) src = src.replaceAll(`"${from}"`, JSON.stringify(to));
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(out).toString("base64")}`;
};
const { trackMonth, trackLine, compareMonth } = await import(
  url("../src/lib/finance/month-tracker.ts", { "./spend-category": url("../src/lib/finance/spend-category.ts") }),
);

const bill = (o = {}) => ({ vendor_name: "Cosentino Plumbing", vendor_type: "subcontractor", trade: "plumbing", invoice_date: "2026-11-03", amount: 1000, paid_amount: 0, payment_status: "unpaid", payment_method: "check", ...o });
const shift = (o = {}) => ({ date: "2026-11-02", open: false, paidMinutes: 480, wageCents: 24000, rate: 30, ...o });

test("payroll comes from crew clock-ins; ADP and in-house labor bills are never counted twice", () => {
  const t = trackMonth("2026-11", {
    shifts: [shift(), shift({ date: "2026-11-03" }), shift({ open: true }), shift({ date: "2026-10-31" }), shift({ rate: null, wageCents: 0, paidMinutes: 120 })],
    bills: [bill({ vendor_name: "ADP Payroll", amount: 9000 }), bill({ vendor_name: "In-House Labor", amount: 500 })],
    receipts: [],
  });
  assert.equal(t.lines.payroll, 48000);
  assert.equal(t.hours, 18);
  assert.equal(t.missingRateHours, 2);
  assert.equal(t.openShifts, 1);
  assert.equal(t.billCount, 0);
});

test("bills land on subs, materials, card and the other lines by bill date", () => {
  const t = trackMonth("2026-11", {
    shifts: [],
    bills: [
      bill(),
      bill({ vendor_name: "Building Center of Essex", vendor_type: "supplier", trade: "carpentry", amount: 400, payment_status: "paid", paid_amount: 400 }),
      bill({ vendor_name: "Home Depot", vendor_type: "supplier", payment_method: "capital_one", amount: 75 }),
      bill({ vendor_name: "The Rest Stop", vendor_type: "supplier", trade: "", description: "portable toilet rental", amount: 120 }),
      bill({ vendor_name: "Speedway", vendor_type: "supplier", trade: "fuel", description: "Fuel fill-up", amount: 60, is_overhead: true }),
      bill({ invoice_date: "2026-10-30", amount: 999 }),
      bill({ invoice_date: null, amount: 5 }),
      bill({ duplicate_of_id: "x", amount: 7 }),
      bill({ payment_method: "internal", amount: 8 }),
    ],
    receipts: [{ received_date: "2026-11-02", amount: 5000 }, { received_date: "2026-10-31", amount: 1 }],
  });
  assert.equal(t.lines.subs, 100000);
  assert.equal(t.lines.materials, 40000);
  assert.equal(t.lines.card, 7500);
  assert.equal(t.lines.site, 12000);
  assert.equal(t.lines.vehicles, 6000);
  assert.equal(t.total, 165500);
  assert.equal(t.billCount, 5);
  assert.equal(t.unpaid, 100000 + 7500 + 12000 + 6000);
  assert.equal(t.undated, 1);
  assert.equal(t.receipts, 500000);
});

test("card purchases stay on the card line whatever they bought", () => {
  assert.equal(trackLine(bill({ payment_method: "credit_card" })), "card");
  assert.equal(trackLine(bill({ payment_method: "check" })), "subs");
});

test("month-end check: subs + materials vs checks, card vs card statement, payroll vs ADP", () => {
  const t = trackMonth("2026-10", {
    shifts: [shift({ date: "2026-10-05", wageCents: 800000 })],
    bills: [bill({ invoice_date: "2026-10-03", amount: 3000 }), bill({ invoice_date: "2026-10-04", vendor_name: "Home Depot", vendor_type: "supplier", amount: 500 }),
      bill({ invoice_date: "2026-10-04", payment_method: "capital_one", amount: 200 })],
    receipts: [{ received_date: "2026-10-09", amount: 10000 }],
  });
  const groups = { payroll: 1000000, subs: 350000, card: 9999999, insurance: 0, site: 0, vehicles: 0, permits: 0, office: 0, other: 0 };
  const rows = compareMonth(t, { deposits: 1100000, returned: 100000, byGroup: groups, cardPurchases: 20000 });
  const row = (k) => rows.find((r) => r.key === k);
  assert.equal(row("receipts").diff, 0);
  assert.equal(row("payroll").diff, -200000);
  assert.equal(row("subs").tracked, 350000);
  assert.equal(row("subs").diff, 0);
  assert.equal(row("card").bank, 20000, "compared with card statement purchases, not the payoff");
  assert.equal(row("card").diff, 0);
  const pending = compareMonth(t, null);
  assert.ok(pending.every((r) => r.bank === null && r.diff === null));
});
