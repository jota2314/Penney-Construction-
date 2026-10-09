import type { CollectionInvoice } from "./collection-invoices";

/** Same edit restrictions as the project's native invoice editor. */
export function canReviewInvoiceDraft(invoice: CollectionInvoice): boolean {
  return invoice.status === "draft" && Boolean(invoice.updated_at) && !invoice.paid_at && !invoice.paid_amount && !invoice.quickbooks_invoice_id && !invoice.sent_to_client_at;
}

export function groupCollectionInvoices(invoices: CollectionInvoice[]) {
  const issued: CollectionInvoice[] = [];
  const scheduled: CollectionInvoice[] = [];
  const drafts: CollectionInvoice[] = [];
  const history: CollectionInvoice[] = [];
  for (const invoice of invoices) {
    if (["paid", "void", "cancelled"].includes(invoice.status)) history.push(invoice);
    else if (invoice.status === "draft" && !invoice.sent_to_client_at && !invoice.paid_at && !invoice.paid_amount) {
      (invoice.milestone ? scheduled : drafts).push(invoice);
    } else issued.push(invoice);
  }
  scheduled.sort((a, b) => (a.milestone?.sort_order ?? 0) - (b.milestone?.sort_order ?? 0));
  issued.sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  return { issued, scheduled, drafts, history };
}
