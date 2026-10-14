import { createHash } from "node:crypto";

/** This is a proposed job allocation basis, not an existing accounting policy.
 * Final audit acceptance must record this method and the source fingerprint.
 * Inputs use database dollars; every amount in the result is integer cents. */
export const OVERHEAD_ALLOCATION_VERSION = "monthly-net-receipts-v1";
export type OverheadAllocation = {
  method: "monthly_net_receipts";
  allocated: number | null;
  fingerprint: string;
  blockers: string[];
  months: {
    month: string;
    overhead: number;
    companyReceipts: number;
    jobReceipts: number;
    allocated: number | null;
    payrollComplete: boolean;
  }[];
  source_register: Record<string, string>;
};

type Amount = number | string | null;
export type OverheadReceiptSource = {
  id: string; project_id: string | null; received_date: string | null; amount: Amount;
};
export type OverheadPayrollSource = {
  month: string; office_burdened: Amount; fees: Amount; source_note?: string | null;
};
export type OverheadProjectSource = { id: string; is_overhead: boolean };
export type OverheadBillClassification = {
  duplicate_of_id?: string | null; is_capex?: boolean | null;
  vendor_name?: string | null; payment_method?: string | null;
  estimate_line_items?: { description?: string | null } | { description?: string | null }[] | null;
};
export type OverheadBillSource = OverheadBillClassification & {
  id: string; project_id: string | null; invoice_date: string | null; amount: Amount;
};
export type OverheadAllocationInput = {
  projectId: string;
  /** Complete lifetime inventory, including reversals and receipts without dates. */
  jobReceipts: OverheadReceiptSource[];
  /** Complete company inventory for all years represented by jobReceipts. */
  companyReceipts: OverheadReceiptSource[];
  payroll: OverheadPayrollSource[];
  bills: OverheadBillSource[];
  overheadProjects: OverheadProjectSource[];
  asOf: string;
};

/** Shared with the existing company report: do not create a second expense policy. */
export function classifyOverheadBill(bill: OverheadBillClassification): "duplicate" | "capex" | "excluded" | "office_payroll" | "running_cost" {
  if (bill.duplicate_of_id) return "duplicate";
  if (bill.is_capex) return "capex";
  const vendor = bill.vendor_name ?? "";
  if ((/^adp/i.test(vendor) && !/adpro/i.test(vendor)) || bill.payment_method === "internal") return "excluded";
  const line = Array.isArray(bill.estimate_line_items) ? bill.estimate_line_items[0] : bill.estimate_line_items;
  return /payroll/i.test(line?.description ?? "") ? "office_payroll" : "running_cost";
}

const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value !== null && typeof value === "object"
    ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`
    : JSON.stringify(value) ?? "null";
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const cents = (value: Amount): number | null => {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return null;
  const result = Math.round(Number(value) * 100);
  return Number.isSafeInteger(result) ? result : null;
};
export function overheadReceiptMonth(date: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date.slice(0, 7) : null;
}
const receiptSource = (r: OverheadReceiptSource) => ({ id: r.id, project_id: r.project_id, received_date: r.received_date, amount: cents(r.amount) ?? r.amount });
// Multiply in integer space before rounding half away from zero, avoiding
// floating point drift on large amounts and exact half-cent allocations.
function allocateCents(overhead: number, job: number, company: number): number {
  const numerator = BigInt(overhead) * BigInt(job);
  const denominator = BigInt(company);
  const absolute = numerator < BigInt(0) ? -numerator : numerator;
  const rounded = absolute / denominator + (absolute % denominator * BigInt(2) >= denominator ? BigInt(1) : BigInt(0));
  return Number(numerator < BigInt(0) ? -rounded : rounded);
}

export function calculateOverheadAllocation(input: OverheadAllocationInput): OverheadAllocation {
  const blockers = new Set<string>();
  const badMonths = new Set<string>();
  const register: Record<string, string> = {};
  const jobByMonth = new Map<string, number>();
  const seenJob = new Set<string>();
  const fail = (message: string, month?: string) => { blockers.add(message); if (month) badMonths.add(month); };
  for (const r of input.jobReceipts) {
    register[`overhead_job_receipts:${r.id}`] = hash(receiptSource(r));
    const month = overheadReceiptMonth(r.received_date);
    if (seenJob.has(r.id)) fail(`Receipt ${r.id} appears twice in the job inventory.`, month ?? undefined);
    seenJob.add(r.id);
    if (r.project_id !== input.projectId) fail(`Receipt ${r.id} does not belong to this job.`, month ?? undefined);
    if (!month) { fail(`Receipt ${r.id} has no valid received date.`); continue; }
    const amount = cents(r.amount);
    if (amount === null) fail(`Receipt ${r.id} has no valid amount.`, month);
    jobByMonth.set(month, (jobByMonth.get(month) ?? 0) + (amount ?? 0));
  }
  const used = new Set(jobByMonth.keys());
  const companyByMonth = new Map<string, number>();
  const companyById = new Map<string, OverheadReceiptSource>();
  for (const r of input.companyReceipts) {
    const month = overheadReceiptMonth(r.received_date);
    if (!month || !used.has(month)) continue;
    if (companyById.has(r.id)) fail(`Receipt ${r.id} appears twice in the company inventory.`, month);
    companyById.set(r.id, r);
    register[`overhead_company_receipts:${r.id}`] = hash(receiptSource(r));
    const amount = cents(r.amount);
    if (amount === null) fail(`Company receipt ${r.id} has no valid amount.`, month);
    companyByMonth.set(month, (companyByMonth.get(month) ?? 0) + (amount ?? 0));
  }
  // Independent queries can race a receipt edit. Never combine mismatched
  // numerators/denominators or certify a truncated company inventory.
  for (const r of input.jobReceipts) {
    if (overheadReceiptMonth(r.received_date) && hash(receiptSource(r)) !== (companyById.has(r.id) ? hash(receiptSource(companyById.get(r.id)!)) : null)) {
      fail(`Receipt ${r.id} changed or is missing from the company inventory; refresh the audit.`, overheadReceiptMonth(r.received_date) ?? undefined);
    }
  }
  for (const r of companyById.values()) if (r.project_id === input.projectId && !seenJob.has(r.id)) {
    fail(`New job receipt ${r.id} appeared during the audit; refresh the audit.`, overheadReceiptMonth(r.received_date) ?? undefined);
  }

  const pool = new Map<string, number>();
  const payrollMonths = new Set<string>();
  for (const p of input.payroll) {
    const month = overheadReceiptMonth(p.month);
    if (!month || !used.has(month)) continue;
    register[`overhead_payroll:${p.month}`] = hash({ month: p.month, office_burdened: cents(p.office_burdened) ?? p.office_burdened, fees: cents(p.fees) ?? p.fees, source_note: p.source_note ?? null });
    if (payrollMonths.has(month)) fail(`${month}: multiple payroll splits need reconciliation.`, month);
    payrollMonths.add(month);
    const office = cents(p.office_burdened), fees = cents(p.fees);
    if (office === null || fees === null) fail(`${month}: the payroll split has an invalid amount.`, month);
    pool.set(month, (pool.get(month) ?? 0) + (office ?? 0) + (fees ?? 0));
  }
  const overheadIds = new Set(input.overheadProjects.filter(p => p.is_overhead).map(p => p.id));
  for (const p of input.overheadProjects) register[`overhead_projects:${p.id}`] = hash({ id: p.id, is_overhead: p.is_overhead });
  if (!overheadIds.size) fail("No overhead project is available; verify company overhead coverage.");
  const seenBills = new Set<string>();
  for (const b of input.bills) {
    const month = overheadReceiptMonth(b.invoice_date);
    if (!month || !used.has(month) || !b.project_id || !overheadIds.has(b.project_id)) continue;
    const classification = classifyOverheadBill(b);
    register[`overhead_bills:${b.id}`] = hash({ id: b.id, project_id: b.project_id, invoice_date: b.invoice_date, amount: cents(b.amount) ?? b.amount, classification, duplicate_of_id: b.duplicate_of_id ?? null });
    if (seenBills.has(b.id)) fail(`Bill ${b.id} appears twice in the overhead inventory.`, month);
    seenBills.add(b.id);
    if (classification !== "office_payroll" && classification !== "running_cost") continue;
    const amount = cents(b.amount);
    if (amount === null) fail(`Overhead bill ${b.id} has no valid amount.`, month);
    pool.set(month, (pool.get(month) ?? 0) + (amount ?? 0));
  }

  const asOf = new Date(input.asOf);
  const currentMonth = Number.isFinite(asOf.getTime()) ? asOf.toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7) : null;
  if (!currentMonth) fail("The audit date is invalid; month completeness cannot be established.");
  if (![...jobByMonth.values()].some(n => n > 0)) fail("This job has no positive net monthly receipts to support an overhead allocation.");
  const months = [...used].sort().map(month => {
    const overhead = pool.get(month) ?? 0;
    const companyReceipts = companyByMonth.get(month) ?? 0;
    const jobReceipts = jobByMonth.get(month) ?? 0;
    const payrollComplete = payrollMonths.has(month);
    if (!payrollComplete) fail(`${month}: no office/field payroll split is recorded.`, month);
    if (!currentMonth || month >= currentMonth) fail(`${month}: the current or future month is not complete.`, month);
    if (companyReceipts <= 0) fail(`${month}: company net receipts must be positive before allocating overhead.`, month);
    if (jobReceipts < 0) fail(`${month}: negative job net receipts require reconciliation before allocating overhead.`, month);
    if (overhead < 0) fail(`${month}: the negative overhead pool requires reconciliation before allocation.`, month);
    if (jobReceipts > companyReceipts && companyReceipts > 0) fail(`${month}: job receipts exceed company net receipts; reconcile reversals before allocating more than the monthly pool.`, month);
    if (![overhead, companyReceipts, jobReceipts].every(Number.isSafeInteger)) fail(`${month}: amounts exceed safe cent precision.`, month);
    let allocated = badMonths.has(month) ? null : allocateCents(overhead, jobReceipts, companyReceipts);
    if (allocated !== null && !Number.isSafeInteger(allocated)) { fail(`${month}: allocated overhead exceeds safe cent precision.`, month); allocated = null; }
    return { month, overhead, companyReceipts, jobReceipts, allocated, payrollComplete };
  });
  // Only month closed/open state matters, not the wall-clock timestamp. An
  // accepted result remains stable until sources or period coverage change.
  register[`overhead_basis:${input.projectId}`] = hash({ version: OVERHEAD_ALLOCATION_VERSION, projectId: input.projectId, method: "monthly_net_receipts", periods: months.map(m => ({ month: m.month, closed: !!currentMonth && m.month < currentMonth })) });
  const source_register = Object.fromEntries(Object.entries(register).sort(([a], [b]) => a.localeCompare(b)));
  const total = months.reduce((sum, m) => sum + (m.allocated ?? 0), 0);
  if (!Number.isSafeInteger(total)) fail("Total overhead allocation exceeds safe cent precision.");
  const orderedBlockers = [...blockers].sort();
  return { method: "monthly_net_receipts", allocated: orderedBlockers.length ? null : total, fingerprint: hash({ version: OVERHEAD_ALLOCATION_VERSION, projectId: input.projectId, source_register, blockers: orderedBlockers }), blockers: orderedBlockers, months, source_register };
}
