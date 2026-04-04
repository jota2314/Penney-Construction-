-- Link invoices to specific estimate line items for budget vs actual tracking
ALTER TABLE invoices
  ADD COLUMN estimate_line_item_id uuid REFERENCES estimate_line_items(id) ON DELETE SET NULL;

CREATE INDEX idx_invoices_estimate_line_item ON invoices(estimate_line_item_id);

-- Also add subcontractor_id so we can match invoices to the sub who did the work
ALTER TABLE invoices
  ADD COLUMN subcontractor_id uuid REFERENCES subcontractors(id) ON DELETE SET NULL;

CREATE INDEX idx_invoices_subcontractor ON invoices(subcontractor_id);
