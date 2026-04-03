-- Price book: every price from every supplier, with full history
CREATE TABLE IF NOT EXISTS price_book (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name text NOT NULL,
  category text NOT NULL,
  subcategory text,
  unit_price numeric(12,2) NOT NULL,
  unit_type text NOT NULL DEFAULT 'each',
  quantity numeric(10,2),
  total_price numeric(12,2),
  supplier_name text NOT NULL,
  supplier_id uuid REFERENCES subcontractors(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  project_name text,
  quote_request_id uuid REFERENCES quote_requests(id) ON DELETE SET NULL,
  quote_date date,
  notes text,
  source text NOT NULL DEFAULT 'quote',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_book_category ON price_book(category);
CREATE INDEX IF NOT EXISTS idx_price_book_item ON price_book(item_name);
CREATE INDEX IF NOT EXISTS idx_price_book_supplier ON price_book(supplier_name);
CREATE INDEX IF NOT EXISTS idx_price_book_date ON price_book(quote_date DESC);

ALTER TABLE price_book ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage price_book" ON price_book
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Estimate enhancements
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS total_cost numeric(12,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS total_profit numeric(12,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS markup_pct numeric(5,2) DEFAULT 30;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS estimate_type text DEFAULT 'preliminary';
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft';

ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS cost numeric(12,2);
ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS markup_pct numeric(5,2) DEFAULT 30;
ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS client_price numeric(12,2);
ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS profit numeric(12,2);
ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS quote_status text DEFAULT 'known';
ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS sub_quote_id uuid REFERENCES quote_requests(id) ON DELETE SET NULL;
ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS scope_text text;
