export interface CreditInvoice {
  id: string;
  invoice_number: number;
  amount: number;
  status: string;
  updated_at: string;
  sent_to_client_at: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  quickbooks_invoice_id: string | null;
  quickbooks_id?: string | null;
  quickbooks_doc_number: string | null;
}

export interface InvoiceCreditOption {
  id: string;
  change_order_number: number;
  title: string;
  price_impact: number;
  updated_at: string;
}

export function canCreditSentInvoice(invoice: CreditInvoice): boolean {
  return invoice.status === "sent" && !!invoice.sent_to_client_at
    && !invoice.paid_at && !Number(invoice.paid_amount)
    && !invoice.quickbooks_invoice_id && !invoice.quickbooks_id && !invoice.quickbooks_doc_number
    && Number(invoice.amount) > 0;
}

/** Older invoice lines identify their source by CO number instead of UUID. */
export function containsChangeOrderCredit(lines: unknown, credit: Pick<InvoiceCreditOption, "id" | "change_order_number">): boolean {
  if (!Array.isArray(lines)) return false;
  const reference = new RegExp(`(?:^|[^a-z0-9_])(?:change\\s+order|co)\\s*#?\\s*0*${credit.change_order_number}(?![a-z0-9_])`, "i");
  return lines.some((line) => line && typeof line === "object" && (
    line.change_order_id === credit.id ||
    (Number(line.amount) < 0 && typeof line.description === "string" && reference.test(line.description))
  ));
}
