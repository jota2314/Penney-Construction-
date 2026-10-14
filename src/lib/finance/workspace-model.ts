import type { OverheadAllocation } from "./overhead-allocation";

export type FinanceRecord = {
  id: string;
  project_id: string;
  kind: "forecast" | "final" | "reopen";
  created_at: string;
  actor_name: string;
  closed_on: string | null;
  payload: {
    contract: number | null;
    cost: number;
    remaining?: number;
    budget?: number | null;
    profit?: number;
    margin?: number | null;
    note: string;
    review_id?: string;
    report_file_id?: string;
    report_name?: string;
    hours?: number;
    scopes?: unknown[];
    financial_basis?: string;
    final_cost?: number;
    payroll_burden?: number;
    allocated_overhead?: number;
    overhead_allocation?: OverheadAllocation;
    received?: number;
    gross_profit?: number;
    source_register?: Record<string, string>;
    evidence?: unknown[];
  };
};
export type ProjectHealth = {
  id: string;
  name: string;
  number: string;
  status: string;
  closedOn: string | null;
  contract: number | null;
  budget: number | null;
  vendorCost: number;
  laborCost: number;
  cost: number;
  hours: number;
  received: number;
  outstanding: number;
  overdue: number;
  warnings: string[];
  reviewDate: string | null;
  audit: FinanceRecord | null;
  forecast: FinanceRecord | null;
  finalNeedsReview: boolean;
  financialBasis: string;
};
export type CollectionRow = {
  id: string;
  projectId: string;
  projectName: string;
  number: number;
  title: string;
  amount: number;
  balance: number;
  due: string | null;
  daysLate: number;
  issue: string | null;
};
export const cents = (value: unknown): number | null =>
  value == null || value === "" || !Number.isFinite(Number(value))
    ? null
    : Math.round(Number(value) * 100);
export const total = <T>(rows: T[], get: (row: T) => number) =>
  rows.reduce((sum, row) => sum + get(row), 0);
export function latestRecords(records: FinanceRecord[]) {
  const ordered = [...records].sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
  return {
    audit: ordered.find((r) => r.kind !== "forecast") ?? null,
    forecast: ordered.find((r) => r.kind === "forecast") ?? null,
  };
}
export function forecastFor(job: ProjectHealth) {
  const p = job.forecast?.payload;
  if (!p || p.remaining == null) return null;
  const stale =
    p.cost !== job.cost ||
    p.contract !== job.contract ||
    p.budget !== job.budget ||
    (!!p.financial_basis && p.financial_basis !== job.financialBasis);
  return {
    remaining: p.remaining,
    profit:
      job.contract === null ? null : job.contract - job.cost - p.remaining,
    stale,
  };
}
export function healthFor(job: ProjectHealth): {
  label: string;
  tone: "good" | "warn" | "bad" | "neutral";
} {
  if (job.audit?.kind === "final")
    return job.finalNeedsReview
      ? { label: "Final · new activity", tone: "warn" }
      : { label: "Financially closed", tone: "good" };
  if (job.warnings.length) return { label: "Needs verification", tone: "warn" };
  const forecast = forecastFor(job);
  if (
    job.contract !== null &&
    (job.cost > job.contract ||
      (forecast &&
        !forecast.stale &&
        forecast.profit !== null &&
        forecast.profit < 0))
  )
    return { label: "Loss risk", tone: "bad" };
  if (job.budget !== null && job.cost > job.budget)
    return { label: "Over budget", tone: "bad" };
  if (job.overdue > 0) return { label: "Collection overdue", tone: "warn" };
  if (!forecast || forecast.stale)
    return { label: "Forecast needed", tone: "neutral" };
  return { label: "Within recorded plan", tone: "good" };
}
export function closedPeriod(
  records: FinanceRecord[],
  year: string,
  month: string,
) {
  return records.filter(
    (r) =>
      r.kind === "final" &&
      r.closed_on &&
      (year === "all" || r.closed_on.slice(0, 4) === year) &&
      (month === "all" || r.closed_on.slice(5, 7) === month),
  );
}
export function collectionBalance(
  invoice: {
    amount: unknown;
    paid_amount: unknown;
    status: string;
    sent_to_client_at: string | null;
  },
  receipts: { amount: unknown }[],
) {
  if (
    !invoice.sent_to_client_at ||
    ["draft", "void", "voided", "cancelled"].includes(invoice.status)
  )
    return null;
  const amount = cents(invoice.amount),
    paid = cents(invoice.paid_amount) ?? 0;
  const linked = total(receipts, (r) => cents(r.amount) ?? 0);
  const issue =
    amount === null || receipts.some((r) => cents(r.amount) === null)
      ? "Amount needs verification"
      : linked !== paid
        ? "Linked receipts and invoice paid amount differ"
        : invoice.status === "paid" && paid < amount
          ? "Paid status and recorded amount differ"
          : null;
  return {
    balance: amount === null ? 0 : Math.max(0, amount - Math.max(paid, linked)),
    issue,
  };
}
