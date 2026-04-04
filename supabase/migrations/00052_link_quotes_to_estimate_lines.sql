-- Link quotes directly to estimate line items (not by trade matching)
ALTER TABLE quote_requests
  ADD COLUMN estimate_line_item_id uuid REFERENCES estimate_line_items(id) ON DELETE SET NULL;

CREATE INDEX idx_quotes_estimate_line ON quote_requests(estimate_line_item_id);
