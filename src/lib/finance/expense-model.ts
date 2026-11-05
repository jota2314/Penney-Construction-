import { spendCategoryFor, type SpendCategory } from "./spend-category";

type Amount = number | string | null;
type Project = { name: string | null; project_number: string | null; is_overhead: boolean | null };
export type ExpenseRecord = {
  id: string; vendor_name: string | null; vendor_type: string | null; trade: string | null;
  description: string | null; invoice_number: string | null; amount: Amount; paid_amount: Amount;
  invoice_date: string | null; payment_status: string | null; payment_method: string | null;
  project_id: string | null; split_group_id: string | null; estimate_line_item_id: string | null;
  projects: Project | Project[] | null;
  estimate_line_items?: { description: string | null } | { description: string | null }[] | null;
  duplicate_of_id?: string | null; source?: string | null; review_status?: string | null;
  is_capex?: boolean | null;
};
export type ExpenseAllocation = {
  record: ExpenseRecord; category: SpendCategory; assignment: "project" | "overhead" | "unassigned";
  projectLabel: string; amountCents: number | null; paidCents: number | null; openCents: number | null;
  reasons: string[]; paymentIssue: boolean; quickbooksImport: boolean; missingAllocation: boolean;
};
export type ExpenseGroup = {
  key: string; id: string; vendor: string; reference: string | null; date: string | null;
  allocations: ExpenseAllocation[]; projects: string[]; categories: SpendCategory[];
  amountCents: number | null; paidCents: number | null; openCents: number | null;
  reasons: string[]; filteredSplit: boolean;
};

export function expenseCents(value: Amount | undefined): number | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const result = Math.sign(number) * Math.round((Math.abs(number) + Number.EPSILON) * 100);
  return Number.isSafeInteger(result) ? result : null;
}

function isDay(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isInternal(row: ExpenseRecord): boolean {
  return row.payment_method === "internal" || /^(in.house labor|penney construction \(labor\))$/i.test((row.vendor_name ?? "").trim());
}

function allocationFor(record: ExpenseRecord): ExpenseAllocation {
  const project = Array.isArray(record.projects) ? record.projects[0] : record.projects;
  const line = Array.isArray(record.estimate_line_items) ? record.estimate_line_items[0] : record.estimate_line_items;
  const assignment = !record.project_id ? "unassigned" : project?.is_overhead ? "overhead" : "project";
  const amountCents = expenseCents(record.amount);
  const explicitPaid = expenseCents(record.paid_amount);
  const hasPaidValue = record.paid_amount !== null && record.paid_amount !== undefined;
  const reasons: string[] = [];
  let paidCents: number | null = explicitPaid;
  let openCents: number | null = null;
  let paymentIssue = false;
  const paymentProblem = (reason: string) => { paymentIssue = true; reasons.push(reason); };
  if (amountCents === null) reasons.push("Bill amount needs verification");
  if (hasPaidValue && explicitPaid === null) paymentProblem("Recorded payment amount is invalid");
  if (!hasPaidValue) {
    if (record.payment_status === "paid") paidCents = amountCents;
    else if (record.payment_status === "unpaid") paidCents = 0;
    else paymentProblem("Recorded payment amount is missing");
  }
  if (!["paid", "partial", "unpaid"].includes(record.payment_status ?? "")) paymentProblem("Payment status needs verification");
  if (amountCents !== null && paidCents !== null) {
    if (amountCents >= 0) {
      if (paidCents < 0 || paidCents > amountCents) paymentProblem("Recorded payment is outside the bill amount");
      // A malformed negative payment must not inflate the amount owed.
      openCents = paidCents < 0 ? null : Math.max(0, amountCents - paidCents);
    } else {
      // A credit reduces recorded cost. It is not automatically applied to an unrelated payable.
      openCents = 0;
      if (paidCents > 0 || paidCents < amountCents) paymentProblem("Credit payment amount needs verification");
    }
    if (record.payment_status === "paid" && paidCents !== amountCents) paymentProblem("Paid status differs from the recorded payment amount");
    if (record.payment_status === "unpaid" && paidCents !== 0) paymentProblem("Unpaid status has a recorded payment");
    if (record.payment_status === "partial" && (paidCents === 0 || paidCents === amountCents)) paymentProblem("Partial status needs reconciliation");
  }
  if (amountCents !== null && amountCents < 0) openCents = 0;
  const missingAllocation = !record.project_id || !record.estimate_line_item_id;
  if (missingAllocation) reasons.push("Job or budget line is missing");
  if (record.review_status !== "ok") reasons.push("Record has not been confirmed");
  const quickbooksImport = /^(qb(?:_|$)|quickbooks)/i.test(record.source ?? "");
  if (quickbooksImport) reasons.push("QuickBooks import — verify against Penney source records");
  return {
    record, assignment, amountCents, paidCents, openCents, reasons, paymentIssue, quickbooksImport, missingAllocation,
    projectLabel: assignment === "unassigned" ? "Unassigned job" : project?.name || project?.project_number || "Project unavailable",
    category: spendCategoryFor({ vendorName: record.vendor_name, vendorType: record.vendor_type, trade: record.trade, description: record.description, lineItemText: line?.description, isOverhead: assignment === "overhead" }),
  };
}

const knownSum = (rows: ExpenseAllocation[], pick: (row: ExpenseAllocation) => number | null) => rows.reduce((sum, row) => sum + (pick(row) ?? 0), 0);
const completeSum = (rows: ExpenseAllocation[], pick: (row: ExpenseAllocation) => number | null) => rows.some(row => pick(row) === null) ? null : knownSum(rows, pick);

export function expenseSummary(allocations: ExpenseAllocation[]) {
  const coherentPayments = allocations.filter(a => a.amountCents !== null && a.paidCents !== null && a.openCents !== null && !a.paymentIssue);
  return {
    chargesCents: knownSum(allocations, a => a.amountCents === null ? null : Math.max(0, a.amountCents)),
    creditsCents: knownSum(allocations, a => a.amountCents === null ? null : Math.max(0, -a.amountCents)),
    netCents: knownSum(allocations, a => a.amountCents),
    paidCents: knownSum(allocations, a => a.paidCents),
    openCents: knownSum(allocations, a => a.openCents),
    // A partial subtotal must never include contradictory values (for example,
    // a paid status with explicit paid_amount=0) or estimate missing payments.
    knownPaidCents: knownSum(coherentPayments, a => a.paidCents),
    knownOpenCents: knownSum(coherentPayments, a => a.openCents),
    knownPaymentCount: coherentPayments.length,
    unresolvedPaymentCount: allocations.length - coherentPayments.length,
    projectCents: knownSum(allocations.filter(a => a.assignment === "project"), a => a.amountCents),
    overheadCents: knownSum(allocations.filter(a => a.assignment === "overhead"), a => a.amountCents),
    unassignedCents: knownSum(allocations.filter(a => a.assignment === "unassigned"), a => a.amountCents),
    capitalCents: knownSum(allocations.filter(a => a.record.is_capex), a => a.amountCents),
    recordCount: allocations.length,
    billCount: new Set(allocations.map(a => a.record.split_group_id ? `split:${a.record.split_group_id}` : `bill:${a.record.id}`)).size,
    invalidAmountCount: allocations.filter(a => a.amountCents === null).length,
    unknownPaymentCount: allocations.filter(a => a.paidCents === null || a.openCents === null).length,
    paymentIssueCount: allocations.filter(a => a.paymentIssue).length,
    reviewCount: allocations.filter(a => a.reasons.length > 0).length,
    qbImportedCount: allocations.filter(a => a.quickbooksImport).length,
    missingAllocationCount: allocations.filter(a => a.missingAllocation).length,
    unassignedCount: allocations.filter(a => a.assignment === "unassigned").length,
  };
}
export type ExpenseSummary = ReturnType<typeof expenseSummary>;

/** Bill-date purchases, independent of payment date and imported bank movements.
 * Sum allocations before display grouping; filters must affect every displayed total.
 */
export function buildExpenseView(records: ExpenseRecord[], options: {
  start: string; end: string; category?: string | null; unallocatedOnly?: boolean;
}) {
  const seen = new Set<string>();
  const eligible = records.filter(row => {
    if (row.duplicate_of_id || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  const inPeriod = (row: ExpenseRecord) => isDay(row.invoice_date) && row.invoice_date >= options.start && row.invoice_date <= options.end;
  const external = eligible.filter(row => !isInternal(row));
  const periodAllocations = external.filter(inPeriod).map(allocationFor);
  // Same vendor/reference/date with different captures is a candidate repeat,
  // not a legitimate extra split allocation. Keep it visible for source review.
  const submissions = new Map<string, Set<string>>();
  const identity = (record: ExpenseRecord) => record.invoice_number?.trim() && record.vendor_name?.trim()
    ? JSON.stringify([record.vendor_name.trim().toLowerCase(), record.invoice_number.trim(), record.invoice_date]) : null;
  for (const allocation of periodAllocations) {
    const key = identity(allocation.record);
    if (!key) continue;
    const captures = submissions.get(key) ?? new Set<string>();
    captures.add(allocation.record.split_group_id ? `split:${allocation.record.split_group_id}` : `bill:${allocation.record.id}`);
    submissions.set(key, captures);
  }
  for (const allocation of periodAllocations) {
    const key = identity(allocation.record);
    if (key && (submissions.get(key)?.size ?? 0) > 1) allocation.reasons.push("Possible repeated bill submission — verify the source");
  }
  const allocations = periodAllocations.filter(a => (!options.category || a.category.key === options.category) && (!options.unallocatedOnly || a.missingAllocation));
  const splitSizes = new Map<string, number>();
  for (const row of external) if (row.split_group_id) splitSizes.set(row.split_group_id, (splitSizes.get(row.split_group_id) ?? 0) + 1);
  const grouped = new Map<string, ExpenseAllocation[]>();
  for (const allocation of allocations) {
    // Different bill dates belong in their own period buckets. A split with
    // inconsistent dates must never move one month's cost into another month.
    const key = allocation.record.split_group_id ? `split:${allocation.record.split_group_id}:${allocation.record.invoice_date}` : `bill:${allocation.record.id}`;
    const group = grouped.get(key) ?? [];
    group.push(allocation);
    grouped.set(key, group);
  }
  const groups: ExpenseGroup[] = [...grouped.entries()].map(([key, items]) => {
    items.sort((a, b) => (b.record.invoice_date ?? "").localeCompare(a.record.invoice_date ?? "") || a.record.id.localeCompare(b.record.id));
    const head = items[0].record;
    const vendors = [...new Set(items.map(a => a.record.vendor_name || "Unknown vendor"))];
    const references = [...new Set(items.map(a => a.record.invoice_number).filter(Boolean))];
    const reasons = [...new Set(items.flatMap(a => a.reasons))];
    if (vendors.length > 1) reasons.push("Split allocations have different vendors");
    if (head.split_group_id && new Set(periodAllocations.filter(a => a.record.split_group_id === head.split_group_id).map(a => a.record.invoice_date)).size > 1) reasons.push("Split allocations have different bill dates");
    return {
      key, id: head.id, vendor: vendors.join(" / "), reference: references.join(" / ") || null,
      date: head.invoice_date, allocations: items,
      projects: [...new Set(items.map(a => a.projectLabel))],
      categories: [...new Map(items.map(a => [a.category.key, a.category])).values()],
      amountCents: completeSum(items, a => a.amountCents), paidCents: completeSum(items, a => a.paidCents), openCents: completeSum(items, a => a.openCents),
      reasons, filteredSplit: !!head.split_group_id && (splitSizes.get(head.split_group_id) ?? 0) > items.length,
    };
  }).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
  return {
    allocations, groups, summary: expenseSummary(allocations),
    undatedCount: external.filter(row => !isDay(row.invoice_date)).length,
    undatedRecords: external.filter(row => !isDay(row.invoice_date)),
    excludedInternalCount: eligible.filter(row => isInternal(row) && inPeriod(row)).length,
  };
}
