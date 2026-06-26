// QuickBooks reconciliation matcher (pure logic, no I/O).
//
// Given QB Invoices (client AR), QB Payments, and the app's projects, propose:
//   1. invoice → project   (via QB customer id, then Job name, then customer)
//   2. payment → invoice    (QB's own LinkedTxn first, then a customer+amount+date
//                            heuristic for payments not yet applied in QB)
//
// Everything here is a *proposal* surfaced to the user for review — nothing is
// written. The route layer fetches the data and calls buildReconcilePreview().

import type { QBInvoice, QBPayment } from "./client";

export interface AppProject {
  id: string;
  name: string;
  project_number: string | null;
  quickbooks_customer_id: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
}

export type MatchConfidence = "exact" | "likely" | "ambiguous" | "none";
export type PaymentSource = "qb_linked" | "qb_paid_unlinked" | "heuristic" | "none";

export interface ProjectMatch {
  projectId: string;
  projectNumber: string | null;
  projectName: string;
  confidence: MatchConfidence;
  method: string; // human-readable: how we matched
}

export interface PaymentMatch {
  source: PaymentSource;
  paymentId: string | null;
  amount: number | null;
  date: string | null;
  /** true once we believe this invoice is genuinely settled */
  isPaid: boolean;
}

export interface InvoiceProposal {
  qbInvoiceId: string;
  docNumber: string | null;
  customerJob: string; // raw QB "Customer:Job"
  amount: number;
  balance: number;
  txnDate: string;
  dueDate: string | null;
  qbStatus: "paid" | "open" | "partial";
  project: ProjectMatch | null;
  payment: PaymentMatch;
  warnings: string[];
}

export interface ReconcilePreview {
  proposals: InvoiceProposal[];
  summary: {
    totalInvoices: number;
    matchedToProject: number;
    unmatchedToProject: number;
    ambiguousProject: number;
    paidReconciled: number;
    openWithSuggestedPayment: number;
    openNoPayment: number;
    totalAmount: number;
    totalOpenBalance: number;
  };
}

/* ── helpers ── */

const norm = (s: string | null | undefined): string =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** QB stores "Customer:Job" (optionally nested). The job is the last segment. */
export function splitCustomerJob(ref: string | undefined): { customer: string; job: string } {
  const raw = (ref ?? "").trim();
  if (!raw) return { customer: "", job: "" };
  const parts = raw.split(":").map((p) => p.trim());
  return { customer: parts[0] ?? "", job: parts[parts.length - 1] ?? "" };
}

const MONEY_EPSILON = 0.01;
const moneyEq = (a: number, b: number) => Math.abs(a - b) <= MONEY_EPSILON;

/* ── invoice → project ── */

function matchProject(inv: QBInvoice, projects: AppProject[]): ProjectMatch | null {
  const customerRefId = inv.CustomerRef?.value;
  const { customer, job } = splitCustomerJob(inv.CustomerRef?.name);

  // 1. Stable QB id anchor — set on a prior reconcile, never guesses again.
  if (customerRefId) {
    const byId = projects.find((p) => p.quickbooks_customer_id === customerRefId);
    if (byId) {
      return { projectId: byId.id, projectNumber: byId.project_number, projectName: byId.name, confidence: "exact", method: "QB customer id" };
    }
  }

  // 2. Job name == project name (handles two-projects-one-customer, e.g. the
  //    two Weidlein jobs, because the Job name disambiguates).
  const jobN = norm(job);
  if (jobN) {
    const byJob = projects.filter((p) => norm(p.name) === jobN);
    if (byJob.length === 1) {
      return { projectId: byJob[0].id, projectNumber: byJob[0].project_number, projectName: byJob[0].name, confidence: "exact", method: "Job name = project name" };
    }
    if (byJob.length > 1) {
      return { projectId: byJob[0].id, projectNumber: byJob[0].project_number, projectName: byJob[0].name, confidence: "ambiguous", method: `Job name matched ${byJob.length} projects` };
    }
  }

  // 3. Fall back to the customer (last name). Likely, but flag if more than one
  //    project belongs to that customer — the user picks the right job.
  const custN = norm(customer);
  if (custN) {
    const byCustomer = projects.filter((p) => {
      const last = norm(p.customer_last_name);
      const full = norm(`${p.customer_first_name ?? ""} ${p.customer_last_name ?? ""}`);
      return (last && custN.includes(last)) || (full && custN === full);
    });
    if (byCustomer.length === 1) {
      return { projectId: byCustomer[0].id, projectNumber: byCustomer[0].project_number, projectName: byCustomer[0].name, confidence: "likely", method: "Customer name (single project)" };
    }
    if (byCustomer.length > 1) {
      return { projectId: byCustomer[0].id, projectNumber: byCustomer[0].project_number, projectName: byCustomer[0].name, confidence: "ambiguous", method: `Customer has ${byCustomer.length} projects — needs review` };
    }
  }

  return null;
}

/* ── payment → invoice ── */

function matchPayment(inv: QBInvoice, payments: QBPayment[]): { match: PaymentMatch; warnings: string[] } {
  const warnings: string[] = [];
  const paid = inv.Balance === 0;
  const partial = inv.Balance > 0 && inv.Balance < inv.TotalAmt;

  // 1. Authoritative: a payment QB already applied to this invoice.
  const linked = payments.find((p) =>
    (p.Line ?? []).some((l) => (l.LinkedTxn ?? []).some((t) => t.TxnType === "Invoice" && t.TxnId === inv.Id))
  );
  if (linked) {
    if (!paid) warnings.push("A payment is linked in QB but the invoice still shows a balance — partial payment?");
    return { match: { source: "qb_linked", paymentId: linked.Id, amount: linked.TotalAmt, date: linked.TxnDate, isPaid: paid }, warnings };
  }

  // 2. QB says paid (Balance 0) but we couldn't find the linking payment in the
  //    pulled set — trust QB's status, just note it.
  if (paid) {
    return { match: { source: "qb_paid_unlinked", paymentId: null, amount: inv.TotalAmt, date: null, isPaid: true }, warnings };
  }

  // 3. Open invoice: look for an un-applied payment that lines up by
  //    customer + amount + a date on/after the invoice. This is the "already
  //    paid in real life but not matched in QB yet" case.
  const custId = inv.CustomerRef?.value;
  const candidate = payments.find((p) => {
    const sameCustomer = !!custId && p.CustomerRef?.value === custId;
    const amountFits = moneyEq(p.TotalAmt, inv.TotalAmt) || (p.UnappliedAmt != null && moneyEq(p.UnappliedAmt, inv.TotalAmt));
    const notBefore = !inv.TxnDate || !p.TxnDate || p.TxnDate >= inv.TxnDate;
    const notAlreadyLinked = !(p.Line ?? []).some((l) => (l.LinkedTxn ?? []).length > 0);
    return sameCustomer && amountFits && notBefore && notAlreadyLinked;
  });
  if (candidate) {
    warnings.push("QB shows this invoice OPEN, but a matching unapplied payment exists — apply it to the invoice in QB to reconcile (this is the 'already paid, not matched yet' case).");
    return { match: { source: "heuristic", paymentId: candidate.Id, amount: candidate.TotalAmt, date: candidate.TxnDate, isPaid: false }, warnings };
  }

  if (partial) warnings.push("Invoice is partially paid in QB.");
  return { match: { source: "none", paymentId: null, amount: null, date: null, isPaid: false }, warnings };
}

/* ── top-level ── */

export function buildReconcilePreview(
  invoices: QBInvoice[],
  payments: QBPayment[],
  projects: AppProject[]
): ReconcilePreview {
  const proposals: InvoiceProposal[] = invoices.map((inv) => {
    const project = matchProject(inv, projects);
    const { match, warnings } = matchPayment(inv, payments);

    const qbStatus: "paid" | "open" | "partial" =
      inv.Balance === 0 ? "paid" : inv.Balance < inv.TotalAmt ? "partial" : "open";

    const allWarnings = [...warnings];
    if (!project) allWarnings.push("Could not match this invoice to a project — pick one in review.");
    else if (project.confidence === "ambiguous") allWarnings.push(`Project match is ambiguous (${project.method}).`);

    return {
      qbInvoiceId: inv.Id,
      docNumber: inv.DocNumber ?? null,
      customerJob: inv.CustomerRef?.name ?? "",
      amount: inv.TotalAmt,
      balance: inv.Balance,
      txnDate: inv.TxnDate,
      dueDate: inv.DueDate ?? null,
      qbStatus,
      project,
      payment: match,
      warnings: allWarnings,
    };
  });

  const summary = {
    totalInvoices: proposals.length,
    matchedToProject: proposals.filter((p) => p.project && p.project.confidence !== "ambiguous").length,
    unmatchedToProject: proposals.filter((p) => !p.project).length,
    ambiguousProject: proposals.filter((p) => p.project?.confidence === "ambiguous").length,
    paidReconciled: proposals.filter((p) => p.payment.isPaid).length,
    openWithSuggestedPayment: proposals.filter((p) => !p.payment.isPaid && p.payment.source === "heuristic").length,
    openNoPayment: proposals.filter((p) => !p.payment.isPaid && p.payment.source === "none").length,
    totalAmount: proposals.reduce((s, p) => s + (p.amount || 0), 0),
    totalOpenBalance: proposals.reduce((s, p) => s + (p.balance || 0), 0),
  };

  return { proposals, summary };
}
