ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS quickbooks_invoice_id text;
ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS quickbooks_doc_number text;
COMMENT ON COLUMN client_invoices.quickbooks_invoice_id IS 'QuickBooks Invoice.Id created for this client invoice';
COMMENT ON COLUMN client_invoices.quickbooks_doc_number IS 'QuickBooks-assigned DocNumber for this invoice';
