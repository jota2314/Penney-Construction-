// Month tracker: what a month costs according to the app, built while the
// month is still running — crew payroll from clock-in/clock-out, plus every
// bill (subs, materials, card purchases, site, vehicles, permits, office…) by
// bill date. When that month's bank statements are imported, compareMonth()
// lines the tracker up against the bank, line by line, so a missing bill, an
// unrecorded payroll run or a wrong category shows up as a difference.
//
// Pure module. All amounts are integer cents.

import { spendCategoryFor } from "./spend-category";

export const TRACK_LINES = [
  { key: "payroll", label: "Crew payroll (clock in/out)" },
  { key: "subs", label: "Subcontractors" },
  { key: "materials", label: "Materials & tools" },
  { key: "card", label: "Card purchases" },
  { key: "insurance", label: "Insurance" },
  { key: "site", label: "Disposal & site costs" },
  { key: "vehicles", label: "Vehicles & fuel" },
  { key: "permits", label: "Permits & licenses" },
  { key: "office", label: "Office, software & marketing" },
  { key: "other", label: "Other" },
] as const;
export type TrackKey = (typeof TRACK_LINES)[number]["key"];
type Lines = Record<TrackKey, number>;
const emptyLines = (): Lines => Object.fromEntries(TRACK_LINES.map((l) => [l.key, 0])) as Lines;

export type TrackBill = {
  id?: string;
  vendor_name: string | null;
  vendor_type?: string | null;
  trade?: string | null;
  description?: string | null;
  line_text?: string | null;
  is_overhead?: boolean | null;
  invoice_date: string | null;
  amount: number | string | null;
  paid_amount: number | string | null;
  payment_status: string | null;
  payment_method: string | null;
  duplicate_of_id?: string | null;
};
export type TrackShift = { date: string; open: boolean; paidMinutes: number; wageCents: number; rate: number | null };
export type TrackReceipt = { received_date: string | null; amount: number | string | null };

export type MonthTrack = {
  key: string;
  lines: Lines;
  total: number;
  billCount: number;
  /** Part of the tracked bills not paid yet. */
  unpaid: number;
  hours: number;
  /** Closed shifts with no pay rate on file — their wages are missing from payroll. */
  missingRateHours: number;
  openShifts: number;
  receipts: number;
  receiptCount: number;
  /** Bills with no date — they can't be placed in any month. */
  undated: number;
};

const cents = (v: number | string | null | undefined) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? 0 : Math.round(n * 100);
};
const CARD = new Set(["capital_one", "credit_card", "amex"]);
const isPayrollPlaceholder = (name: string | null | undefined) =>
  /in.?house\s*labor|penney construction \(labor\)/i.test(name ?? "") ||
  (/\bADP\b/i.test(name ?? "") && !/adpro/i.test(name ?? ""));

/** Which tracker line a bill belongs on. Null = not a cost here (payroll comes from the clock). */
export function trackLine(bill: TrackBill): TrackKey | null {
  if (isPayrollPlaceholder(bill.vendor_name)) return null;
  if (CARD.has((bill.payment_method ?? "").toLowerCase())) return "card";
  const cat = spendCategoryFor({
    vendorName: bill.vendor_name,
    vendorType: bill.vendor_type ?? null,
    trade: bill.trade ?? null,
    description: bill.description ?? null,
    lineItemText: bill.line_text ?? null,
    isOverhead: !!bill.is_overhead,
  }).key;
  if (cat === "subs") return "subs";
  if (cat === "materials" || cat === "tools") return "materials";
  if (cat === "insurance") return "insurance";
  if (cat === "site") return "site";
  if (cat === "vehicles" || cat === "fuel") return "vehicles";
  if (cat === "permits" || cat === "licenses") return "permits";
  if (["software", "utilities", "professional", "marketing", "bank", "meals", "office"].includes(cat)) return "office";
  return "other";
}

export function trackMonth(
  key: string,
  input: { bills: TrackBill[]; shifts: TrackShift[]; receipts: TrackReceipt[] },
): MonthTrack {
  const inMonth = (day: string | null | undefined) => !!day && day.slice(0, 7) === key;
  const t: MonthTrack = {
    key, lines: emptyLines(), total: 0, billCount: 0, unpaid: 0, hours: 0,
    missingRateHours: 0, openShifts: 0, receipts: 0, receiptCount: 0, undated: 0,
  };
  for (const s of input.shifts) {
    if (!inMonth(s.date)) continue;
    if (s.open) { t.openShifts++; continue; }
    const hours = Math.max(0, s.paidMinutes) / 60;
    t.hours += hours;
    if (s.rate === null) t.missingRateHours += hours;
    t.lines.payroll += s.wageCents;
  }
  for (const b of input.bills) {
    if (b.duplicate_of_id || (b.payment_method ?? "").toLowerCase() === "internal") continue;
    if (!b.invoice_date) { t.undated++; continue; }
    if (!inMonth(b.invoice_date)) continue;
    const line = trackLine(b);
    if (!line) continue;
    const amount = cents(b.amount);
    t.lines[line] += amount;
    t.billCount++;
    if (b.payment_status !== "paid") t.unpaid += Math.max(0, amount - Math.max(0, cents(b.paid_amount)));
  }
  for (const r of input.receipts) {
    if (!inMonth(r.received_date)) continue;
    t.receipts += cents(r.amount);
    t.receiptCount++;
  }
  t.hours = Math.round(t.hours * 10) / 10;
  t.missingRateHours = Math.round(t.missingRateHours * 10) / 10;
  t.total = TRACK_LINES.reduce((s, l) => s + t.lines[l.key], 0);
  return t;
}

export type BankMonth = {
  deposits: number;
  returned: number;
  byGroup: Record<"payroll" | "subs" | "card" | "insurance" | "site" | "vehicles" | "permits" | "office" | "other", number>;
  /** Capital One statement purchases dated this month. */
  cardPurchases: number;
};

export type CompareRow = { key: string; label: string; tracked: number; bank: number | null; diff: number | null; note?: string };

/**
 * Tracker vs bank for one month. The bank can't tell a sub's check from a
 * lumberyard's, so subs + materials are compared together against checks and
 * sub/material ACH. Card purchases are compared with the card statement's
 * purchases, not the payoff. Bank null = that month's statement isn't in yet.
 */
export function compareMonth(track: MonthTrack, bank: BankMonth | null): CompareRow[] {
  const b = (n: number) => (bank ? n : null);
  const rows: Omit<CompareRow, "diff">[] = [
    { key: "receipts", label: "Client payments in", tracked: track.receipts, bank: b(bank ? bank.deposits - bank.returned : 0) },
    { key: "payroll", label: "Payroll", tracked: track.lines.payroll, bank: b(bank?.byGroup.payroll ?? 0),
      note: "Clock-in wages before taxes; the ADP draft also carries payroll taxes and fees, so the bank runs higher." },
    { key: "subs", label: "Subs, materials & tools (checks / ACH)", tracked: track.lines.subs + track.lines.materials, bank: b(bank?.byGroup.subs ?? 0),
      note: "Bills by bill date; the bank by the day the check cleared." },
    { key: "card", label: "Card purchases", tracked: track.lines.card, bank: b(bank?.cardPurchases ?? 0), note: "Compared with the Capital One statement." },
    { key: "insurance", label: "Insurance", tracked: track.lines.insurance, bank: b(bank?.byGroup.insurance ?? 0) },
    { key: "site", label: "Disposal & site costs", tracked: track.lines.site, bank: b(bank?.byGroup.site ?? 0) },
    { key: "vehicles", label: "Vehicles & fuel", tracked: track.lines.vehicles, bank: b(bank?.byGroup.vehicles ?? 0) },
    { key: "permits", label: "Permits & licenses", tracked: track.lines.permits, bank: b(bank?.byGroup.permits ?? 0) },
    { key: "office", label: "Office, software & marketing", tracked: track.lines.office, bank: b(bank?.byGroup.office ?? 0) },
    { key: "other", label: "Other", tracked: track.lines.other, bank: b(bank?.byGroup.other ?? 0) },
  ];
  return rows.map((r) => ({ ...r, diff: r.bank === null ? null : r.tracked - r.bank }));
}
