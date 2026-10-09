import { resolvePaymentDate } from "./payment-date";

export interface CollectionProject {
  id: string;
  name: string;
  contract_value: number | null;
  contract_locked_amount: number | null;
  outstanding: number;
}
export interface CollectionInvoice {
  id: string;
  project_id: string;
  title: string;
  amount: number;
  paid_amount: number | null;
  status: string;
  due_date: string | null;
  sent_to_client_at: string | null;
  source: string | null;
}
export interface CollectionMilestone {
  id: string;
  project_id: string;
  label: string;
  stage_key: string;
  amount: number | null;
  percent: number | null;
  status: string;
  client_invoice_id: string | null;
}
export interface CollectionPhase {
  project_id: string | null;
  name: string;
  end_date: string | null;
  start_date: string | null;
  planned_end_date: string | null;
  planned_start_date: string | null;
  phase_scope: string | null;
  event_type: string | null;
  status: string;
}
export interface CollectionReceipt {
  project_id: string | null;
  client_invoice_id: string | null;
  amount: number;
}
export interface CollectionItem {
  id: string;
  projectId: string;
  projectName: string;
  label: string;
  amount: number;
  date: string | null;
  basis: "invoice" | "milestone";
  anchor: string | null;
}
export interface CollectionPlan {
  asOf: string;
  weekStart: string;
  weekEnd: string;
  monthStart: string;
  monthEnd: string;
  week: number;
  month: number;
  overdue: number;
  needsDate: number;
  reviewProjects: number;
  items: CollectionItem[];
}

const cents = (amount: number | null) => Math.round(Number(amount ?? 0) * 100);
const dateString = (date: Date) => date.toISOString().slice(0, 10);
const VOID = new Set(["void", "voided", "cancelled", "canceled"]);

/** Remaining collections, using Eastern calendar weeks (Monday–Sunday).
 * Invoice due dates take precedence over projected construction milestone dates.
 * Milestones are estimates of when a draw becomes billable, not promises to pay.
 * The active contract balance caps each job; conflicting records require review.
 */
export function buildCollectionPlan(input: {
  today: string;
  projects: CollectionProject[];
  invoices: CollectionInvoice[];
  milestones: CollectionMilestone[];
  phases: CollectionPhase[];
  receipts: CollectionReceipt[];
}): CollectionPlan {
  const today = new Date(`${input.today}T12:00:00Z`);
  const weekStart = new Date(today);
  weekStart.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12));
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 12));
  const plan: CollectionPlan = {
    asOf: input.today, weekStart: dateString(weekStart), weekEnd: dateString(weekEnd),
    monthStart: dateString(monthStart), monthEnd: dateString(monthEnd),
    week: 0, month: 0, overdue: 0, needsDate: 0, reviewProjects: 0, items: [],
  };
  const invoices = new Map(input.invoices.map(i => [i.id, i]));
  const applied = new Map<string, number>();
  for (const receipt of input.receipts) {
    const invoice = receipt.client_invoice_id ? invoices.get(receipt.client_invoice_id) : null;
    if (invoice && invoice.project_id === receipt.project_id) {
      applied.set(invoice.id, (applied.get(invoice.id) ?? 0) + cents(receipt.amount));
    }
  }

  for (const project of input.projects) {
    const budget = Math.max(0, cents(project.outstanding));
    if (!budget) continue;
    const rows: CollectionItem[] = [];
    const seenInvoices = new Set<string>();
    const phases = input.phases.filter(p => p.project_id === project.id && p.phase_scope === "master"
      && !["crew", "meeting", "shop_meeting", "walkthrough"].includes(p.event_type ?? "")
      && !VOID.has(p.status))
      .map(p => ({ name: p.name, end: p.end_date || p.planned_end_date || p.start_date || p.planned_start_date }))
      .filter((p): p is { name: string; end: string } => !!p.end);
    let review = false;
    const balance = (invoice: CollectionInvoice) => {
      const linked = applied.get(invoice.id) ?? 0;
      const recorded = cents(invoice.paid_amount);
      if (linked && linked !== recorded) review = true;
      return Math.max(0, cents(invoice.amount) - Math.max(linked, recorded));
    };
    const eligible = (invoice: CollectionInvoice) => !VOID.has(invoice.status)
      && !/^(qb|quickbooks)/i.test(invoice.source ?? "");

    // Count native sent invoices once, even if more than one milestone links to one.
    for (const invoice of input.invoices.filter(i => i.project_id === project.id)) {
      if (!eligible(invoice) || invoice.status === "draft" || !invoice.sent_to_client_at) continue;
      seenInvoices.add(invoice.id);
      if (invoice.status === "paid") continue;
      const amount = balance(invoice);
      if (!amount) continue;
      rows.push({ id: invoice.id, projectId: project.id, projectName: project.name,
        label: invoice.title, amount: amount / 100, date: invoice.due_date,
        basis: "invoice", anchor: null });
    }

    for (const milestone of input.milestones.filter(m => m.project_id === project.id)) {
      if (milestone.status === "paid" || VOID.has(milestone.status)) continue;
      const linked = milestone.client_invoice_id ? invoices.get(milestone.client_invoice_id) : null;
      if (linked && (linked.project_id !== project.id || seenInvoices.has(linked.id)
        || !eligible(linked) || linked.status === "paid")) continue;
      if (milestone.client_invoice_id && !linked) { review = true; continue; }
      if (linked) seenInvoices.add(linked.id);
      const basis = Number(project.contract_locked_amount ?? project.contract_value ?? 0);
      const amount = linked ? balance(linked) : milestone.amount !== null ? cents(milestone.amount)
        : Math.round(basis * Number(milestone.percent ?? 0));
      if (amount <= 0) { review = true; continue; }
      const anchor = resolvePaymentDate(milestone.stage_key, milestone.label, phases, true);
      rows.push({ id: milestone.id, projectId: project.id, projectName: project.name,
        label: milestone.label, amount: amount / 100, date: anchor?.end ?? null,
        basis: "milestone", anchor: anchor?.requires.join(" · ") ?? null });
    }
    const known = rows.reduce((sum, row) => sum + cents(row.amount), 0);
    if (known > budget) {
      // Do not guess which draw a receipt/credit paid, or silently move it between periods.
      review = true;
      plan.needsDate += budget / 100;
    } else {
      plan.items.push(...rows);
      plan.needsDate += (budget - known) / 100;
    }
    if (review) plan.reviewProjects++;
  }
  plan.items.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.projectName.localeCompare(b.projectName));
  for (const item of plan.items) {
    if (!item.date || (item.basis === "milestone" && item.date < plan.asOf)) {
      plan.needsDate += item.amount;
      continue;
    }
    if (item.date < plan.asOf) { plan.overdue += item.amount; continue; }
    if (item.date <= plan.weekEnd) plan.week += item.amount;
    if (item.date <= plan.monthEnd) plan.month += item.amount;
  }
  for (const key of ["week", "month", "overdue", "needsDate"] as const) plan[key] = Math.round(plan[key] * 100) / 100;
  return plan;
}
