type Amount = number | string | null;

export type BankPeriodBounds = { start: string; end: string };
export type BankRecordLink = {
  id: string; invoice_id: string | null; payment_id: string | null;
  amount_applied: Amount; confidence: string | null;
};
export type BankPeriodRecord = {
  id: string; txn_date: string | null; source: string | null; amount: Amount;
  direction: string | null; description: string | null; category_key: string | null;
  check_number: string | null; statement_file: string | null; statement_month: string | null;
  match_status: string | null; match_note: string | null; external_ref: string | null;
  bank_transaction_matches?: BankRecordLink[] | null;
};
export type BankPeriodIssue = { code: string; message: string; recordId?: string; linkId?: string };
export type BankDebitCategory = "payroll" | "cardRepayments" | "checks" | "other";
export type BankPeriodLink = BankRecordLink & { amountCents: number | null; issues: BankPeriodIssue[] };
export type BankPeriodRow = BankPeriodRecord & {
  amountCents: number | null; category: BankDebitCategory | "credit" | null;
  issues: BankPeriodIssue[]; matches: BankPeriodLink[]; linkedCents: number;
  remainingCents: number | null; matchingIssues: BankPeriodIssue[];
};
export type BankPeriodTotals = {
  debitsCents: number; creditsCents: number; netCents: number;
  payrollCents: number; cardRepaymentsCents: number; checksCents: number; otherCents: number;
};
export type BankPeriod = BankPeriodBounds & {
  status: "available" | "empty" | "invalid";
  totals: BankPeriodTotals | null; rows: BankPeriodRow[];
  count: number; debitCount: number; creditCount: number; duplicateCount: number;
  linkedRowCount: number; noLinkRowCount: number; matchingIssueCount: number;
  firstDate: string | null; through: string | null; statementFiles: string[];
  statementMonths: string[]; issues: BankPeriodIssue[];
  coverage: "unverified"; reconciled: false;
};

// The accounting account_id is a cost category, not a bank account. These
// source values identify Eastern imports. A new Eastern source must be
// reviewed explicitly; it must not silently enlarge or disappear from cash.
const EASTERN_SOURCES = new Set(["eastern_ach", "eastern_check", "eastern_deposit"]);
export function isEasternBankSource(source: string | null | undefined): boolean {
  return !!source && EASTERN_SOURCES.has(source);
}

function isDay(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function assertBankPeriod(bounds: BankPeriodBounds): void {
  if (!isDay(bounds.start) || !isDay(bounds.end) || bounds.start > bounds.end) {
    throw new Error("Invalid bank period: valid inclusive start and end dates are required.");
  }
}

/** Bank values carry direction separately. Never round fractional cents or
 * coerce a missing amount to zero. Numeric database values and decimal strings
 * both become safe integer cents before any addition. */
export function bankAmountCents(value: Amount | undefined): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,2})(0*))?$/.exec(text);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(whole) && Number.isSafeInteger(cents) ? cents : null;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
function fingerprint(row: BankPeriodRecord): string {
  // Saved link problems must not invalidate independent bank cash. Merge
  // child links for identical parent rows, then validate them separately.
  const bank = { ...row };
  delete bank.bank_transaction_matches;
  return stable(bank);
}

function linksFor(record: BankPeriodRecord, amountCents: number | null) {
  const matchingIssues: BankPeriodIssue[] = [];
  const matches: BankPeriodLink[] = [];
  const variants = new Map<string, Map<string, BankRecordLink>>();
  for (const [index, link] of (record.bank_transaction_matches ?? []).entries()) {
    const key = link.id || `missing:${index}`;
    const entries = variants.get(key) ?? new Map<string, BankRecordLink>();
    entries.set(stable(link), link);
    variants.set(key, entries);
  }
  let linkedCents = 0;
  for (const entries of variants.values()) {
    for (const link of entries.values()) {
      const issues: BankPeriodIssue[] = [];
      const problem = (code: string, message: string) => issues.push({ code, message, recordId: record.id, linkId: link.id });
      const cents = bankAmountCents(link.amount_applied);
      if (!link.id) problem("missing_link_id", "Saved record link has no identifier.");
      if (entries.size > 1) problem("conflicting_link", "Saved links with the same identifier disagree.");
      if (cents === null) problem("invalid_link_amount", "Saved record link has an invalid amount.");
      if (Boolean(link.invoice_id) === Boolean(link.payment_id)) problem("invalid_link_target", "Saved record link must identify exactly one bill or receipt.");
      if (issues.length === 0 && cents !== null) {
        if (!Number.isSafeInteger(linkedCents + cents)) problem("link_sum_overflow", "Saved record link amounts exceed the supported range.");
        else linkedCents += cents;
      }
      matches.push({ ...link, amountCents: cents, issues });
      matchingIssues.push(...issues);
    }
  }
  if (amountCents !== null && linkedCents > amountCents) {
    matchingIssues.push({ code: "overlinked", message: "Saved record links exceed this bank movement.", recordId: record.id });
  }
  return {
    matches, linkedCents, matchingIssues,
    remainingCents: amountCents === null || matchingIssues.length > 0 ? null : amountCents - linkedCents,
  };
}

/** Imported cash only, independent of bill dates, expense costs and payroll
 * allocations. Available means arithmetic is usable, not statement-certified
 * or reconciled. Saved link metadata is never proof of verification. */
export function summarizeBankPeriod(records: BankPeriodRecord[], bounds: BankPeriodBounds): BankPeriod {
  assertBankPeriod(bounds);
  const inPeriod = (day: string) => day >= bounds.start && day <= bounds.end;
  const variants = new Map<string, Map<string, BankPeriodRecord>>();
  let duplicateCount = 0;
  for (const [index, record] of records.entries()) {
    // Card purchase records and other banks never enter Eastern cash. A new
    // unrecognized Eastern source remains visible as an invalid-source issue.
    if (!isEasternBankSource(record.source) && !record.source?.startsWith("eastern")) continue;
    const key = record.id || `missing:${index}`;
    const entries = variants.get(key) ?? new Map<string, BankPeriodRecord>();
    const signature = fingerprint(record);
    const existing = entries.get(signature);
    if (existing) {
      duplicateCount++;
      existing.bank_transaction_matches = [...(existing.bank_transaction_matches ?? []), ...(record.bank_transaction_matches ?? [])];
    } else entries.set(signature, { ...record, bank_transaction_matches: [...(record.bank_transaction_matches ?? [])] });
    variants.set(key, entries);
  }
  const issues: BankPeriodIssue[] = [];
  const rows: BankPeriodRow[] = [];
  for (const entries of variants.values()) {
    for (const record of entries.values()) {
      if (isDay(record.txn_date) && !inPeriod(record.txn_date)) continue;
      const rowIssues: BankPeriodIssue[] = [];
      const problem = (code: string, message: string) => rowIssues.push({ code, message, recordId: record.id });
      if (!record.id) problem("missing_id", "Bank movement has no identifier.");
      if (entries.size > 1) problem("conflicting_duplicate", "Bank records with the same identifier disagree.");
      if (!isEasternBankSource(record.source)) problem("unsupported_source", "This Eastern import source needs verification before inclusion.");
      if (!isDay(record.txn_date)) problem("invalid_date", "Bank movement has an invalid or missing posting date.");
      const amountCents = bankAmountCents(record.amount);
      if (amountCents === null) problem("invalid_amount", "Bank movement has a missing, negative, invalid or fractional-cent amount.");
      if (record.direction !== "debit" && record.direction !== "credit") problem("invalid_direction", "Bank movement has an invalid direction.");
      let category: BankPeriodRow["category"] = null;
      if (record.direction === "credit") category = "credit";
      if (record.direction === "debit") {
        category = /\bADP\b/i.test(record.description ?? "") ? "payroll"
          : record.category_key === "card_payoff" ? "cardRepayments"
          : record.check_number?.trim() ? "checks" : "other";
      }
      rows.push({ ...record, amountCents, category, issues: rowIssues, ...linksFor(record, amountCents) });
      issues.push(...rowIssues);
    }
  }
  const references = new Map<string, Set<string>>();
  for (const row of rows) {
    const reference = row.external_ref?.trim();
    if (!reference) continue;
    const key = JSON.stringify([row.source, reference]);
    const ids = references.get(key) ?? new Set<string>();
    ids.add(row.id);
    references.set(key, ids);
  }
  for (const row of rows) {
    const reference = row.external_ref?.trim();
    if (!reference || (references.get(JSON.stringify([row.source, reference]))?.size ?? 0) < 2) continue;
    const issue = { code: "possible_duplicate_reference", message: "Different bank records share an external reference; verify the source before totaling.", recordId: row.id };
    row.issues.push(issue);
    issues.push(issue);
  }
  rows.sort((a, b) => (b.txn_date ?? "").localeCompare(a.txn_date ?? "") || (a.id ?? "").localeCompare(b.id ?? ""));
  const totals: BankPeriodTotals = { debitsCents: 0, creditsCents: 0, netCents: 0, payrollCents: 0, cardRepaymentsCents: 0, checksCents: 0, otherCents: 0 };
  if (issues.length === 0) {
    for (const row of rows) {
      const cents = row.amountCents!;
      if (row.direction === "credit") totals.creditsCents += cents;
      else {
        totals.debitsCents += cents;
        totals[`${row.category as BankDebitCategory}Cents`] += cents;
      }
    }
    totals.netCents = totals.creditsCents - totals.debitsCents;
    if (Object.values(totals).some(value => !Number.isSafeInteger(value))) {
      issues.push({ code: "sum_overflow", message: "Bank movement totals exceed the supported range." });
    }
  }
  const dates = rows.map(row => row.txn_date).filter(isDay).sort();
  const distinct = (values: (string | null)[]) => [...new Set(values.filter((value): value is string => !!value))].sort();
  const status = issues.length > 0 ? "invalid" : rows.length > 0 ? "available" : "empty";
  return {
    ...bounds, status, totals: status === "available" ? totals : null, rows,
    count: rows.length, debitCount: rows.filter(row => row.direction === "debit").length,
    creditCount: rows.filter(row => row.direction === "credit").length, duplicateCount,
    linkedRowCount: rows.filter(row => row.matches.length > 0).length,
    noLinkRowCount: rows.filter(row => row.matches.length === 0).length,
    matchingIssueCount: rows.filter(row => row.matchingIssues.length > 0).length,
    firstDate: dates[0] ?? null, through: dates.at(-1) ?? null,
    statementFiles: distinct(rows.map(row => row.statement_file)),
    statementMonths: distinct(rows.map(row => row.statement_month)),
    issues, coverage: "unverified", reconciled: false,
  };
}
