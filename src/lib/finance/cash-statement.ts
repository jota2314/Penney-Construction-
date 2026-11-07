// Cash flow statement built from the imported Eastern Bank checking
// statements — the account every client deposit lands in and every check,
// ACH, payroll run and card payoff leaves from. Within statement coverage the
// bank is the only source: bills and receipts recorded in the app are NOT
// added on top (that double counts card purchases, payroll and checks). After
// the last imported statement, the app's own records stand in, clearly marked
// provisional — the same rule the CEO dashboard uses, so the two agree.
//
// Pure module: no server imports. All math is in integer cents.

type Amount = number | string | null | undefined;

export type StatementBankRow = {
  id?: string;
  txn_date: string;
  source: string;
  amount: Amount;
  direction: string | null;
  description?: string | null;
  category_key?: string | null;
  match_status?: string | null;
};

export type StatementReceipt = { id?: string; received_date: string | null; amount: Amount };

export type StatementBill = {
  id?: string;
  vendor_name?: string | null;
  invoice_date: string | null;
  paid_date?: string | null;
  amount: Amount;
  paid_amount: Amount;
  payment_status: string | null;
  payment_method: string | null;
  duplicate_of_id?: string | null;
};

/** Money-out groups, in statement order. */
export const OUTFLOW_GROUPS = [
  { key: "payroll", label: "Payroll (ADP)" },
  { key: "subs", label: "Subcontractors & suppliers" },
  { key: "card", label: "Credit card payments" },
  { key: "insurance", label: "Insurance" },
  { key: "site", label: "Disposal & site costs" },
  { key: "vehicles", label: "Vehicles & fuel" },
  { key: "permits", label: "Permits & licenses" },
  { key: "office", label: "Office, software & marketing" },
  { key: "other", label: "Other payments" },
] as const;

export type OutflowKey = (typeof OUTFLOW_GROUPS)[number]["key"];
type ByGroup = Record<OutflowKey, number>;

const emptyGroups = (): ByGroup =>
  Object.fromEntries(OUTFLOW_GROUPS.map((g) => [g.key, 0])) as ByGroup;

export type StatementMonth = {
  /** YYYY-MM */
  key: string;
  /** Client deposits (bank credits). */
  deposits: number;
  /** Bounced client checks — money that never actually came in. */
  returned: number;
  /** deposits − returned */
  cashIn: number;
  cashOut: number;
  net: number;
  /** Running net from Jan 1. */
  cumulative: number;
  byGroup: ByGroup;
  bankCount: number;
  /** Client payments recorded in the app with a received date this month. */
  recordedReceipts: number;
};

export type CashStatement = {
  year: number;
  today: string;
  /** Last imported checking transaction. Null = no statements imported this year. */
  through: string | null;
  firstDate: string | null;
  bankCount: number;
  /** Months Jan → statement month. Months with no imported rows are listed in gaps. */
  months: StatementMonth[];
  gaps: string[];
  totals: Omit<StatementMonth, "key" | "cumulative">;
  /** YTD money out by group, largest first, zero groups dropped. */
  outflows: { key: OutflowKey; label: string; amount: number; share: number; count: number }[];
  reconciliation: {
    total: number;
    matched: number;
    open: number;
    openAmount: number;
  };
  /** Capital One card activity (purchases are paid off from checking — counted once, as "Credit card payments"). */
  card: { purchases: number; credits: number; count: number; through: string | null };
  /** Records after the last statement — provisional until that month is imported. */
  after: {
    from: string;
    through: string;
    receipts: number;
    receiptCount: number;
    billsPaid: number;
    billCount: number;
    cardPurchases: number;
    cardCount: number;
  } | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function isDay(value: string | null | undefined): value is string {
  if (!value || !DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Dollars (number or numeric string) → integer cents. Unreadable → null. */
export function toCents(value: Amount): number | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100);
}

const isChecking = (row: StatementBankRow) => row.source.startsWith("eastern");
const isCardStatement = (row: StatementBankRow) => /^cap(ital)?_?one|^capone/i.test(row.source);
export const isReturnedDeposit = (row: StatementBankRow) =>
  row.direction === "debit" && /return(ed)? deposit item/i.test(row.description ?? "");
const isAdp = (text: string | null | undefined) => /\bADP\b/i.test(text ?? "") && !/adpro/i.test(text ?? "");

/** Which statement line a checking debit belongs on. */
export function outflowGroup(row: StatementBankRow): OutflowKey {
  const cat = (row.category_key ?? "").toLowerCase();
  if (cat === "labor" || isAdp(row.description)) return "payroll";
  if (cat === "card_payoff") return "card";
  if (cat === "insurance") return "insurance";
  if (cat === "site") return "site";
  if (cat === "vehicles" || cat === "fuel") return "vehicles";
  if (cat === "permits" || cat === "licenses") return "permits";
  if (["software", "marketing", "office", "utilities", "meals", "bank", "professional"].includes(cat)) return "office";
  // Checks carry no payee on the statement; they are how subs and yards get paid.
  if (cat === "subs" || cat === "materials" || cat === "tools" || row.source === "eastern_check") return "subs";
  return "other";
}

const RECONCILED = new Set(["matched", "partial", "no_invoice_expected", "reconciled"]);

const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export function buildCashStatement(input: {
  bank: StatementBankRow[];
  receipts: StatementReceipt[];
  bills: StatementBill[];
  today: string;
}): CashStatement {
  const { today } = input;
  if (!isDay(today)) throw new Error("Invalid statement date");
  const year = Number(today.slice(0, 4));
  const start = `${year}-01-01`;
  const inYear = (day: string) => day >= start && day <= today;

  // Same transaction imported twice (re-run statement import) counts once.
  const seen = new Set<string>();
  const bank = input.bank.filter((row) => {
    if (!row.id) return true;
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });

  const checking = bank.filter((r) => isChecking(r) && isDay(r.txn_date) && inYear(r.txn_date));
  const through = checking.reduce<string | null>((max, r) => (max === null || r.txn_date > max ? r.txn_date : max), null);
  const firstDate = checking.reduce<string | null>((min, r) => (min === null || r.txn_date < min ? r.txn_date : min), null);
  const lastMonth = through ? Number(through.slice(5, 7)) : 0;

  const months: StatementMonth[] = Array.from({ length: lastMonth }, (_, i) => ({
    key: `${year}-${String(i + 1).padStart(2, "0")}`,
    deposits: 0,
    returned: 0,
    cashIn: 0,
    cashOut: 0,
    net: 0,
    cumulative: 0,
    byGroup: emptyGroups(),
    bankCount: 0,
    recordedReceipts: 0,
  }));
  const counts = emptyGroups();
  const reconciliation = { total: 0, matched: 0, open: 0, openAmount: 0 };

  for (const row of checking) {
    const cents = toCents(row.amount);
    if (cents === null) throw new Error(`Bank transaction ${row.id ?? row.txn_date} has no readable amount`);
    const amount = Math.abs(cents);
    const month = months[Number(row.txn_date.slice(5, 7)) - 1];
    month.bankCount++;
    reconciliation.total++;
    if (RECONCILED.has((row.match_status ?? "").toLowerCase())) reconciliation.matched++;
    else {
      reconciliation.open++;
      reconciliation.openAmount += amount;
    }
    if (row.direction === "credit") month.deposits += amount;
    else if (row.direction === "debit") {
      if (isReturnedDeposit(row)) month.returned += amount;
      else {
        const group = outflowGroup(row);
        month.byGroup[group] += amount;
        month.cashOut += amount;
        counts[group]++;
      }
    } else throw new Error(`Bank transaction ${row.id ?? row.txn_date} has no direction`);
  }

  for (const r of input.receipts) {
    if (!isDay(r.received_date) || !inYear(r.received_date)) continue;
    const month = months[Number(r.received_date.slice(5, 7)) - 1];
    if (!month) continue;
    month.recordedReceipts += toCents(r.amount) ?? 0;
  }

  let running = 0;
  for (const m of months) {
    m.cashIn = m.deposits - m.returned;
    m.net = m.cashIn - m.cashOut;
    running += m.net;
    m.cumulative = running;
  }

  const totals = months.reduce<CashStatement["totals"]>(
    (t, m) => {
      t.deposits += m.deposits;
      t.returned += m.returned;
      t.cashIn += m.cashIn;
      t.cashOut += m.cashOut;
      t.net += m.net;
      t.bankCount += m.bankCount;
      t.recordedReceipts += m.recordedReceipts;
      for (const g of OUTFLOW_GROUPS) t.byGroup[g.key] += m.byGroup[g.key];
      return t;
    },
    { deposits: 0, returned: 0, cashIn: 0, cashOut: 0, net: 0, byGroup: emptyGroups(), bankCount: 0, recordedReceipts: 0 },
  );

  const outflows = OUTFLOW_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    amount: totals.byGroup[g.key],
    share: totals.cashOut ? totals.byGroup[g.key] / totals.cashOut : 0,
    count: counts[g.key],
  }))
    .filter((g) => g.amount !== 0)
    .sort((a, b) => b.amount - a.amount);

  const card = { purchases: 0, credits: 0, count: 0, through: null as string | null };
  for (const row of bank) {
    if (!isCardStatement(row) || !isDay(row.txn_date) || !inYear(row.txn_date)) continue;
    const cents = Math.abs(toCents(row.amount) ?? 0);
    card.count++;
    if (row.direction === "debit") card.purchases += cents;
    else card.credits += cents;
    if (card.through === null || row.txn_date > card.through) card.through = row.txn_date;
  }

  let after: CashStatement["after"] = null;
  const afterFrom = through ? nextDay(through) : start;
  if (afterFrom <= today) {
    const inAfter = (day: string | null | undefined): day is string => isDay(day) && day >= afterFrom && day <= today;
    after = { from: afterFrom, through: today, receipts: 0, receiptCount: 0, billsPaid: 0, billCount: 0, cardPurchases: 0, cardCount: 0 };
    for (const r of input.receipts) {
      if (!inAfter(r.received_date)) continue;
      after.receipts += toCents(r.amount) ?? 0;
      after.receiptCount++;
    }
    for (const b of input.bills) {
      if (b.duplicate_of_id || b.payment_status !== "paid") continue;
      const method = (b.payment_method ?? "").toLowerCase();
      if (method === "internal") continue;
      // In-house labor rows are job-costing placeholders and ADP is payroll —
      // both reach the bank as payroll, which isn't recorded as a bill.
      if (/in.?house\s*labor|penney construction \(labor\)/i.test(b.vendor_name ?? "") || isAdp(b.vendor_name)) continue;
      const day = isDay(b.paid_date) ? b.paid_date : b.invoice_date;
      if (!inAfter(day)) continue;
      const paid = toCents(b.paid_amount);
      const amount = paid && paid > 0 ? paid : toCents(b.amount) ?? 0;
      if (["capital_one", "credit_card", "amex"].includes(method)) {
        after.cardPurchases += amount;
        after.cardCount++;
      } else {
        after.billsPaid += amount;
        after.billCount++;
      }
    }
  }

  const gaps = months.filter((m) => m.bankCount === 0).map((m) => m.key);

  return {
    year,
    today,
    through,
    firstDate,
    bankCount: totals.bankCount,
    months,
    gaps,
    totals,
    outflows,
    reconciliation,
    card,
    after,
  };
}
