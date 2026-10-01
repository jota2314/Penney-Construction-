/** Payment presentation only. Never changes invoice or job-cost assignments. */
export interface PaymentAllocation {
  id: string;
  amount: number | null;
  paid_amount: number | null;
  payment_status: string | null;
  vendor_name: string | null;
  description: string | null;
  project_id: string | null;
  split_group_id: string | null;
  is_capex?: boolean | null;
  review_status?: string | null;
  projects: { is_overhead: boolean | null } | { is_overhead: boolean | null }[] | null;
}

export const PAYMENT_BUCKETS = {
  project: { label: "Direct job payments", detail: "Paid allocations to jobs" },
  overhead: { label: "Assigned overhead", detail: "Recorded overhead assignments; excludes ADP, card payments and assets" },
  card: { label: "Card payments", detail: "Settlement of card purchases; job allocations stay on the purchases" },
  payroll: { label: "ADP payroll payments", detail: "Office and field payroll combined; job labor stays on the jobs" },
  capital: { label: "Asset purchases", detail: "Purchases marked as capital assets" },
  review: { label: "Needs classification", detail: "Unassigned payments, flagged overhead and loan repayments to resolve" },
} as const;
export type PaymentBucket = keyof typeof PAYMENT_BUCKETS;

export function paymentBucket(row: PaymentAllocation): PaymentBucket {
  if (row.id.startsWith("bank:")) return "card";
  if (/^adp\b/i.test(row.vendor_name ?? "")) return "payroll";
  if (row.is_capex) return "capital";
  const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
  if (!row.project_id || !project) return "review";
  if (!project.is_overhead) return "project";
  // A review flag or an explicit loan repayment is not evidence of overhead.
  // Keep the full payment unresolved; do not infer principal or interest.
  if (row.review_status === "needs_review" || /\bloan repayment\b/i.test(row.description ?? "")) return "review";
  return "overhead";
}

export const paymentAmount = (row: PaymentAllocation): number =>
  row.payment_status === "paid" ? Number(row.paid_amount || row.amount || 0) : Number(row.amount || 0);

export function summarizePayments(rows: PaymentAllocation[]) {
  const cents = Object.fromEntries(Object.keys(PAYMENT_BUCKETS).map(key => [key, 0])) as Record<PaymentBucket, number>;
  const ids = Object.fromEntries(Object.keys(PAYMENT_BUCKETS).map(key => [key, new Set<string>()])) as Record<PaymentBucket, Set<string>>;
  for (const row of rows) {
    if (row.payment_status !== "paid") continue;
    const bucket = paymentBucket(row);
    cents[bucket] += Math.round(paymentAmount(row) * 100);
    ids[bucket].add(row.split_group_id || row.id);
  }
  return Object.fromEntries(Object.keys(PAYMENT_BUCKETS).map(key => {
    const bucket = key as PaymentBucket;
    return [bucket, { total: cents[bucket] / 100, count: ids[bucket].size }];
  })) as Record<PaymentBucket, { total: number; count: number }>;
}

/** Group only after classification/filtering, and retain every allocation. */
export function groupPaymentRows<T extends PaymentAllocation>(rows: T[]): (T & { allocations: T[] })[] {
  const groups = new Map<string, T & { allocations: T[] }>();
  for (const row of rows) {
    const key = row.split_group_id || row.id;
    const group = groups.get(key);
    if (!group) groups.set(key, { ...row, allocations: [row] });
    else {
      group.amount = Number(group.amount || 0) + Number(row.amount || 0);
      group.paid_amount = Number(group.paid_amount || 0) + Number(row.paid_amount || 0);
      if (group.payment_status !== row.payment_status) group.payment_status = "partial";
      group.allocations.push(row);
    }
  }
  return [...groups.values()];
}
