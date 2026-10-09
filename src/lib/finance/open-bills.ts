import { groupReceiptInvoices } from "./receipt-invoice-groups";

type Project = { name: string | null; project_number: string | null };
export type BillRecord = {
  id: string; project_id: string | null; vendor_name: string | null;
  invoice_number: string | null; invoice_date: string | null; due_date: string | null;
  amount: number | string | null; paid_amount: number | string | null;
  payment_status: string | null; payment_method: string | null;
  source: string | null; review_status: string | null; review_reason: string | null;
  description?: string | null;
  duplicate_of_id: string | null; split_group_id: string | null;
  estimate_line_item_id: string | null;
  pay_approval_status: string | null; approved_for_pay_at: string | null;
  projects: Project | Project[] | null;
};
export type OpenBill = {
  id: string; vendor: string; reference: string | null; projects: string[];
  amount: number; dueDate: string | null; overdueDays: number | null;
  approved: boolean; reasons: string[]; recordIds: string[];
};
export type OpenBillsSummary = {
  bills: OpenBill[]; review: OpenBill[]; total: number; reviewBalance: number;
};

const cents = (value: number | string | null) => value === null ? 0 : Math.round(Number(value) * 100);
const quickbooks = (source: string | null) => /^(qb(?:_|$)|quickbooks)/i.test(source ?? "");

/** Display-only reconciliation. Does not mark records paid or approve payment.
 * Split allocations belong to one bill; repeat submissions stay in review.
 * An unpaid status with no remaining balance is a conflict, not another payable.
 */
export function buildOpenBills(records: BillRecord[], today: string): OpenBillsSummary {
  const result: OpenBillsSummary = { bills: [], review: [], total: 0, reviewBalance: 0 };
  const eligible = records.filter(row => !row.duplicate_of_id).map(row => ({
    ...row, vendor_name: row.vendor_name || "Unknown vendor",
    amount: row.amount === null ? null : Number(row.amount),
  }));
  for (const group of groupReceiptInvoices(eligible)) {
    const open = group.rows.filter(row => row.payment_status !== "paid" && (row.amount === null || row.amount > 0));
    if (!open.length) continue;
    const reasons = new Set<string>();
    if (group.submissionCount > 1) reasons.add("Possible repeat submissions — reconcile the bill");
    if (group.amount === null) reasons.add("Missing or conflicting bill amounts");
    let balance = 0;
    for (const row of open) {
      const remaining = cents(row.amount) - cents(row.paid_amount);
      if (!Number.isFinite(remaining) || row.amount === null) reasons.add("Amount needs verification");
      else if (remaining <= 0) reasons.add("Payment status conflicts with a zero or credit balance");
      else balance += remaining;
      if (row.review_status !== "ok") reasons.add(row.review_reason || "Record needs review");
      if (/incoming payment, not a bill/i.test(row.description ?? "")) reasons.add("Record describes an incoming customer payment, not a vendor bill");
      if (!row.project_id || !row.estimate_line_item_id) reasons.add("Job or budget line is missing");
      if (quickbooks(row.source)) reasons.add("QuickBooks import — verify against Penney records");
      if (row.payment_method === "internal" || /^(in.house labor|penney construction \(labor\))$/i.test(row.vendor_name.trim())) reasons.add("Internal labor allocation — verify payroll, not a vendor payable");
      if (row.payment_status !== "unpaid" && row.payment_status !== "partial") reasons.add("Payment status needs verification");
    }
    const dueDates = [...new Set(open.map(row => row.due_date))];
    const dueDate = dueDates.length === 1 ? dueDates[0] : null;
    if (dueDates.length > 1) reasons.add("Allocations have different due dates");
    const projects = [...new Set(group.rows.map(row => {
      const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
      return project?.name || project?.project_number || (row.project_id ? "Project unavailable" : "Unassigned project");
    }))];
    const bill: OpenBill = {
      id: group.head.id, vendor: group.head.vendor_name, reference: group.head.invoice_number,
      projects, amount: balance / 100, dueDate,
      overdueDays: dueDate ? Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${dueDate}T12:00:00Z`)) / 86400000)) : null,
      approved: open.every(row => row.pay_approval_status === "approved" || !!row.approved_for_pay_at),
      reasons: [...reasons], recordIds: group.rows.map(row => row.id),
    };
    if (reasons.size) result.review.push(bill);
    else if (balance > 0) result.bills.push(bill);
  }
  result.bills.sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.vendor.localeCompare(b.vendor));
  result.total = result.bills.reduce((sum, bill) => sum + Math.round(bill.amount * 100), 0) / 100;
  // This is an unreconciled record balance, explicitly not an amount to pay.
  result.reviewBalance = result.review.reduce((sum, bill) => sum + Math.round(bill.amount * 100), 0) / 100;
  return result;
}
