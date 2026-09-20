import { groupReceiptInvoices } from "./receipt-invoice-groups";

type Project = { name: string | null; project_number: string | null };
type Common = {
  id: string; project_id: string | null; amount: number | null;
  description: string | null; source: string | null; review_status: string | null;
  projects: Project | Project[] | null;
};
export type DailyExpense = Common & {
  vendor_name: string; invoice_number: string | null; invoice_date: string | null;
  split_group_id: string | null; payment_status: string | null;
  payment_method: string | null; duplicate_of_id: string | null;
};
export type DailyIncome = Common & {
  payer_name: string | null; received_date: string | null;
  reference_number: string | null; method: string | null;
};
export type LogTransaction = {
  id: string; date: string | null; kind: "income" | "expense"; name: string;
  amount: number | null; description: string; reference: string | null;
  status: string; review: boolean; source: string; method: string | null;
  projects: { id: string; label: string }[]; href: string;
  allocations: number; submissions: number;
  recordIds: string[];
};

function projectsFor(rows: Common[]) {
  return [...new Map(rows.filter(r => r.project_id).map(r => {
    const p = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    return [r.project_id!, { id: r.project_id!, label: [p?.project_number, p?.name].filter(Boolean).join(" · ") || "Job" }];
  })).values()];
}
const fromQuickBooks = (source: string | null) => /^(qb(?:_|$)|quickbooks)/i.test(source ?? "");
const amountOf = (n: number | null) => n === null || !Number.isFinite(Number(n)) ? null : Number(n);

/** Booked activity, not bank cash flow: bills use invoice date and face value.
 * No bank ledger is mixed in, which would count matched transactions twice.
 */
export function buildDailyLog(expenses: DailyExpense[], income: DailyIncome[]): LogTransaction[] {
  const bills = expenses.filter(r => !r.duplicate_of_id && r.payment_method !== "internal" && !fromQuickBooks(r.source));
  const result: LogTransaction[] = groupReceiptInvoices(bills).map(g => {
    const r = g.head;
    const statuses = new Set(g.rows.map(r => r.payment_status));
    const dates = new Set(g.rows.map(r => r.invoice_date));
    return {
      id: `expense:${r.id}`, date: dates.size === 1 ? r.invoice_date : null, kind: "expense", name: r.vendor_name || "Unknown vendor",
      amount: amountOf(g.amount), description: r.description ?? "", reference: r.invoice_number,
      status: statuses.size > 1 ? "Mixed payment status" : r.payment_status === "paid" ? "Paid" : r.payment_status === "partial" ? "Partly paid" : "Unpaid",
      review: dates.size > 1 || g.submissionCount > 1 || g.amount === null || g.rows.some(r => r.review_status === "needs_review"),
      source: r.source ?? "Penney record", method: r.payment_method, projects: projectsFor(g.rows),
      href: `/spent/${r.id}`, allocations: g.allocationCount, submissions: g.submissionCount,
      recordIds: g.rows.map(row => row.id),
    };
  });
  for (const r of income.filter(r => !fromQuickBooks(r.source))) {
    result.push({
      id: `income:${r.id}`, date: r.received_date, kind: "income", name: r.payer_name || "Client payment",
      amount: amountOf(r.amount), description: r.description ?? "", reference: r.reference_number,
      status: "Received", review: r.review_status === "needs_review" || amountOf(r.amount) === null,
      source: r.source ?? "Penney record", method: r.method, projects: projectsFor([r]),
      href: r.review_status === "needs_review" ? "/payments/review" : r.project_id ? `/projects/${r.project_id}?tab=finances` : "/payments",
      allocations: 1, submissions: 1,
      recordIds: [r.id],
    });
  }
  return result.sort((a,b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
}

export function logTotals(rows: LogTransaction[]) {
  let income = 0, expenses = 0, review = 0;
  for (const r of rows) {
    // Unreviewed and conflicting records stay visible without inflating totals.
    if (r.review || r.amount === null) { review++; continue; }
    if (r.kind === "income") income += Math.round(r.amount * 100);
    else expenses += Math.round(r.amount * 100);
  }
  return { income: income / 100, expenses: expenses / 100, difference: (income - expenses) / 100, review };
}

export function validMonth(value: string | undefined, today: string) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0,4)) >= 1900 && Number(value.slice(0,4)) <= 2200 ? value : today.slice(0,7);
}
