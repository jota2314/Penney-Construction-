export interface RevisableInvoice {
  status: string;
  sent_to_client_at?: string | null;
  paid_at?: string | null;
  paid_amount?: number | null;
  quickbooks_invoice_id?: string | null;
  quickbooks_id?: string | null;
  quickbooks_doc_number?: string | null;
}

/**
 * Mirrors finance_internal.revise_invoice: an unpaid draft or sent invoice with
 * no applied receipts is corrected in place, under its own number, even when it
 * already has a QuickBooks copy. The database re-checks every rule.
 */
export function canReviseClientInvoice(invoice: RevisableInvoice, hasAppliedReceipts: boolean): boolean {
  return (invoice.status === "draft" || invoice.status === "sent")
    && !invoice.paid_at && !Number(invoice.paid_amount) && !hasAppliedReceipts;
}

/** The client already has this invoice, so a revision is a correction of record. */
export function isIssuedInvoice(invoice: RevisableInvoice): boolean {
  return invoice.status !== "draft" || !!invoice.sent_to_client_at;
}

export function hasQuickBooksCopy(
  invoice: Pick<RevisableInvoice, "quickbooks_invoice_id" | "quickbooks_id" | "quickbooks_doc_number">,
): boolean {
  return !!(invoice.quickbooks_invoice_id || invoice.quickbooks_id || invoice.quickbooks_doc_number);
}
