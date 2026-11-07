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
  /** Original contract price, before change orders. */
  baseContract?: number | null;
  /** Approved change orders: price added to the contract. */
  changeOrderPrice?: number;
  changeOrderCount?: number;
  /** Estimated cost: base estimate lines + approved change-order cost. */
  budget: number | null;
  vendorCost: number;
  laborCost: number;
  cost: number;
  hours: number;
  received: number;
  /** Client invoices sent (not drafts or voids). */
  invoiced?: number;
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
  /** Day the invoice was (last) emailed, America/New_York. */
  sent: string | null;
  daysWaiting: number;
  /**
   * A recorded receipt on this job, not linked to any invoice, for exactly this
   * balance and received after the invoice went out. Display only: it still has
   * to be reviewed and applied before the invoice counts as paid.
   */
  loggedPayment: { amount: number; date: string; reference: string | null } | null;
  issue: string | null;
};
/** Keep unresolved invoices and matching, unapplied receipts out of collection
 * totals everywhere. A matching receipt still needs review; this does not mark
 * the invoice paid or change its recorded balance. */
export function isActionableCollection(
  row: Pick<CollectionRow, "issue" | "loggedPayment">,
): boolean {
  return !row.issue && !row.loggedPayment;
}
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
/** Statuses that are not (yet, or any longer) a job being built or closed out. */
export const NOT_A_JOB = ["lead", "estimating", "proposal_sent", "waiting_for_approval", "cancelled", "lost"];

/** Being built, about to start, or closing out — and not financially closed. */
export function isOpenJob(job: Pick<ProjectHealth, "status" | "audit" | "finalNeedsReview">) {
  if (NOT_A_JOB.includes(job.status)) return false;
  return job.audit?.kind !== "final" || job.finalNeedsReview;
}

/**
 * Work-in-progress numbers — the contractor's standard job schedule.
 *
 * Percent complete is cost-to-cost: cost to date ÷ estimated total cost.
 * Earned revenue is that share of the contract. Billed is what the client
 * has been billed: the invoices sent in the app, or the payments received
 * when those are higher (older jobs were billed outside the app). Billed
 * minus earned is over-billing (positive, cash ahead of the work) or
 * under-billing (negative, work done that hasn't been billed yet).
 *
 * Estimated total cost is the saved forecast when it is current, otherwise
 * the estimate budget — never less than what has already been spent.
 */
export type Wip = {
  pct: number | null;
  earned: number | null;
  billed: number;
  overUnder: number | null;
  estimatedCost: number | null;
  toFinish: number | null;
  profit: number | null;
  margin: number | null;
  basis: "forecast" | "budget" | null;
};
export function wipFor(job: ProjectHealth): Wip {
  const forecast = forecastFor(job);
  const billed = Math.max(job.invoiced ?? 0, job.received ?? 0);
  let estimatedCost: number | null = null;
  let basis: Wip["basis"] = null;
  if (forecast && !forecast.stale) {
    estimatedCost = job.cost + Math.max(0, forecast.remaining);
    basis = "forecast";
  } else if (job.budget !== null && job.budget > 0) {
    estimatedCost = Math.max(job.budget, job.cost);
    basis = "budget";
  }
  const pct = estimatedCost && estimatedCost > 0 ? Math.min(1, job.cost / estimatedCost) : null;
  const earned = job.contract !== null && pct !== null ? Math.round(job.contract * pct) : null;
  const profit = job.contract !== null && estimatedCost !== null ? job.contract - estimatedCost : null;
  return {
    pct,
    earned,
    billed,
    overUnder: earned === null ? null : billed - earned,
    estimatedCost,
    toFinish: estimatedCost === null ? null : estimatedCost - job.cost,
    profit,
    margin: profit !== null && job.contract ? profit / job.contract : null,
    basis,
  };
}

/** Under-billing worth acting on: 5% of the contract, at least $2,500. */
export const underbilledBy = (job: ProjectHealth, wip: Wip = wipFor(job)) =>
  wip.overUnder !== null && job.contract !== null && -wip.overUnder >= Math.max(250_000, job.contract * 0.05)
    ? -wip.overUnder
    : 0;

/**
 * One headline per job, from the numbers that move money: losing money, over
 * budget, unbilled work, overdue collections. Bookkeeping gaps (bills not on
 * a budget line, missing rates) stay in `warnings` as data checks — they no
 * longer hide every job behind "Needs verification".
 */
export function healthFor(job: ProjectHealth): {
  label: string;
  tone: "good" | "warn" | "bad" | "neutral";
} {
  if (job.audit?.kind === "final")
    return job.finalNeedsReview
      ? { label: "Final · new activity", tone: "warn" }
      : { label: "Financially closed", tone: "good" };
  const wip = wipFor(job);
  if (job.contract !== null && (job.cost > job.contract || (wip.profit !== null && wip.profit < 0)))
    return { label: "Loss risk", tone: "bad" };
  if (job.budget !== null && job.budget > 0 && job.cost > job.budget)
    return { label: "Over budget", tone: "bad" };
  if (job.overdue > 0) return { label: "Collection overdue", tone: "warn" };
  if (underbilledBy(job, wip) > 0) return { label: "Underbilled", tone: "warn" };
  if (job.contract === null) return { label: "No contract price", tone: "neutral" };
  if (job.budget === null || job.budget <= 0) return { label: "No cost budget", tone: "neutral" };
  return { label: "On track", tone: "good" };
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
