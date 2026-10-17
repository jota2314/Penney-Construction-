type Amount = number | string | null;

export type CashReceipt = { id?: string; received_date: string | null; amount: Amount };
export type CashBill = {
  id?: string;
  invoice_date: string | null;
  paid_date?: string | null;
  paid_date_source?: string | null;
  amount: Amount;
  paid_amount: Amount;
  payment_status: string | null;
  payment_method: string | null;
  duplicate_of_id?: string | null;
};
export type CashBankRow = {
  id?: string;
  txn_date: string;
  source: string;
  amount: Amount;
  direction: string | null;
  description?: string | null;
  category_key?: string | null;
  check_number?: string | null;
};
export type RecordedActivity = {
  received: number;
  receiptCount: number;
  paidBills: number;
  paidBillCount: number;
  directPayments: number;
  cardPurchases: number;
  unclassifiedPayments: number;
  estimatedDateCount: number;
  /** Inventory warnings, not period totals: undated rows cannot be assigned to a month. */
  undatedPayments: number;
  undatedPaymentAmount: number;
  undatedReceipts: number;
  undatedReceiptAmount: number;
  invalidDateCount: number;
  /** Partially paid records without a usable positive payment amount; inventory-wide. */
  unresolvedPaymentAmounts: number;
  unresolvedPaymentIds: string[];
};
export type ImportedBankActivity = {
  received: number;
  spent: number;
  net: number;
  count: number;
  firstDate: string | null;
  through: string | null;
  payroll: number;
  cardPayoff: number;
  checks: number;
  other: number;
};
export type CashFlowSummary = {
  bank: ImportedBankActivity;
  months: { key: string; bank: ImportedBankActivity; records: RecordedActivity }[];
  later: { from: string; through: string; records: RecordedActivity };
};

const DIRECT_METHODS = new Set(["check", "ach", "cash", "wire", "debit_card"]);
const CARD_METHODS = new Set(["capital_one", "credit_card", "amex"]);

function isDay(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toCents(value: Amount, label: string): number {
  if (value === null || (typeof value === "string" && !value.trim())) throw new Error(`Missing ${label} amount`);
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error(`Invalid ${label} amount`);
  const cents = Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error(`Invalid ${label} amount`);
  return cents;
}

function uniqueRows<T extends { id?: string }>(rows: T[], label: string): T[] {
  const seen = new Map<string, string>();
  return rows.filter(row => {
    if (!row.id) return true;
    const fingerprint = JSON.stringify(Object.keys(row).sort().map(key => [key, row[key as keyof T]]));
    const previous = seen.get(row.id);
    if (previous !== undefined) {
      if (previous !== fingerprint) throw new Error(`Conflicting ${label} rows for ${row.id}`);
      return false;
    }
    seen.set(row.id, fingerprint);
    return true;
  });
}

const emptyRecords = (): RecordedActivity => ({
  received: 0, receiptCount: 0, paidBills: 0, paidBillCount: 0,
  directPayments: 0, cardPurchases: 0, unclassifiedPayments: 0,
  estimatedDateCount: 0, undatedPayments: 0, undatedPaymentAmount: 0,
  undatedReceipts: 0, undatedReceiptAmount: 0, invalidDateCount: 0,
  unresolvedPaymentAmounts: 0, unresolvedPaymentIds: [],
});

/** Recorded receipts and paid bill amounts are not bank activity. Undated/invalid-date warnings describe the supplied inventory, not one period. */
export function summarizeRecordedActivity(receipts: CashReceipt[], bills: CashBill[], start: string, end: string): RecordedActivity {
  if (!isDay(start) || !isDay(end)) throw new Error("Invalid recorded-activity period");
  const result = emptyRecords();
  const inPeriod = (day: string) => day >= start && day <= end;
  for (const row of uniqueRows(receipts, "receipt")) {
    // Old/future malformed amounts must not prevent a valid current-period view.
    if (isDay(row.received_date) && !inPeriod(row.received_date)) continue;
    const amount = toCents(row.amount, "receipt");
    if (!isDay(row.received_date)) {
      result.undatedReceipts++;
      result.undatedReceiptAmount += amount;
      if (row.received_date) result.invalidDateCount++;
      continue;
    }
    result.received += amount;
    result.receiptCount++;
  }
  for (const row of uniqueRows(bills, "bill")) {
    const method = row.payment_method?.trim().toLowerCase() ?? "";
    if (row.duplicate_of_id || method === "internal") continue;
    if (row.payment_status !== "paid" && row.payment_status !== "partial") continue;
    const paymentDay = isDay(row.paid_date) ? row.paid_date : null;
    const invoiceDay = isDay(row.invoice_date) ? row.invoice_date : null;
    if (row.paid_date && !paymentDay) result.invalidDateCount++;
    if (!paymentDay && row.invoice_date && !invoiceDay) result.invalidDateCount++;
    const day = paymentDay ?? invoiceDay;
    // A partial bill needs an explicit positive payment; never guess from its face amount.
    // Track unresolved rows across the inventory without making old bad values fatal.
    const rawPaid = Number(row.paid_amount);
    if (row.payment_status === "partial" && (!Number.isFinite(rawPaid) || Math.round(rawPaid * 100) <= 0)) {
      result.unresolvedPaymentAmounts++;
      if (row.id) result.unresolvedPaymentIds.push(row.id);
      if (!day) result.undatedPayments++;
      continue;
    }
    if (day && !inPeriod(day)) continue;
    const recordedPaid = row.paid_amount === null ? 0 : toCents(row.paid_amount, "bill payment");
    const amount = recordedPaid !== 0 ? recordedPaid : toCents(row.amount, "paid bill");
    if (!day) {
      result.undatedPayments++;
      result.undatedPaymentAmount += amount;
      continue;
    }
    // Migration 00129 filled some paid_date values from invoice_date, not bank evidence.
    if (!paymentDay || /invoice_date|backfill/i.test(row.paid_date_source ?? "")) result.estimatedDateCount++;
    result.paidBills += amount;
    result.paidBillCount++;
    if (CARD_METHODS.has(method)) result.cardPurchases += amount;
    else if (DIRECT_METHODS.has(method)) result.directPayments += amount;
    else result.unclassifiedPayments += amount;
  }
  for (const key of ["received", "paidBills", "directPayments", "cardPurchases", "unclassifiedPayments", "undatedPaymentAmount", "undatedReceiptAmount"] as const) result[key] /= 100;
  return result;
}

const emptyBank = (): ImportedBankActivity => ({
  received: 0, spent: 0, net: 0, count: 0, firstDate: null, through: null,
  payroll: 0, cardPayoff: 0, checks: 0, other: 0,
});

function addBankRow(target: ImportedBankActivity, row: CashBankRow, cents: number) {
  target.count++;
  target.firstDate = target.firstDate === null || row.txn_date < target.firstDate ? row.txn_date : target.firstDate;
  target.through = target.through === null || row.txn_date > target.through ? row.txn_date : target.through;
  if (row.direction === "credit") target.received += cents;
  else {
    target.spent += cents;
    if (/\bADP\b/i.test(row.description ?? "") && !/adpro/i.test(row.description ?? "")) target.payroll += cents;
    else if (row.category_key === "card_payoff") target.cardPayoff += cents;
    else if (row.check_number) target.checks += cents;
    else target.other += cents;
  }
}

function dollars(bank: ImportedBankActivity): ImportedBankActivity {
  bank.net = bank.received - bank.spent;
  for (const key of ["received", "spent", "net", "payroll", "cardPayoff", "checks", "other"] as const) bank[key] /= 100;
  return bank;
}

/** Imported checking transactions stay separate from books. Date bounds do not prove statement completeness. No opening balance is available. */
export function summarizeCashFlow(receipts: CashReceipt[], bills: CashBill[], bankRows: CashBankRow[], today: string): CashFlowSummary {
  if (!isDay(today)) throw new Error("Invalid cash-flow date");
  const year = Number(today.slice(0, 4));
  const start = `${year}-01-01`;
  const bank = emptyBank();
  const months = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    const monthEnd = new Date(Date.UTC(year, index + 1, 0)).toISOString().slice(0, 10);
    return { key, bank: emptyBank(), records: summarizeRecordedActivity(receipts, bills, `${key}-01`, monthEnd < today ? monthEnd : today) };
  });
  for (const row of uniqueRows(bankRows, "bank")) {
    if (!row.source.startsWith("eastern")) continue;
    if (!isDay(row.txn_date)) throw new Error(`Invalid bank transaction date${row.id ? ` for ${row.id}` : ""}`);
    if (row.txn_date < start || row.txn_date > today) continue;
    const amount = toCents(row.amount, "bank transaction");
    if (amount < 0) throw new Error("Invalid bank transaction amount: direction carries the sign");
    if (row.direction !== "credit" && row.direction !== "debit") throw new Error("Invalid bank transaction direction");
    addBankRow(bank, row, amount);
    addBankRow(months[Number(row.txn_date.slice(5, 7)) - 1].bank, row, amount);
  }
  // With no bank imports, all current-year records remain provisional.
  const laterStart = bank.through ? new Date(Date.parse(`${bank.through}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : start;
  return {
    bank: dollars(bank),
    months: months.map(month => ({ ...month, bank: dollars(month.bank) })),
    later: { from: laterStart, through: today, records: summarizeRecordedActivity(receipts, bills, laterStart, today) },
  };
}
