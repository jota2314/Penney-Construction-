-- Invoices table for tracking vendor/sub payments per project
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,

  -- Vendor info
  vendor_name text NOT NULL,
  vendor_type text DEFAULT 'subcontractor' CHECK (vendor_type IN ('subcontractor', 'supplier', 'vendor', 'other')),
  trade text,

  -- Invoice details
  invoice_number text,
  invoice_date date,
  due_date date,
  terms text,
  description text,

  -- Money
  amount numeric(12,2) DEFAULT 0,
  paid_amount numeric(12,2) DEFAULT 0,
  payment_status text DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  paid_date date,

  -- Links
  quote_request_id uuid REFERENCES quote_requests(id) ON DELETE SET NULL,
  gmail_message_id text,
  attachment_storage_path text,
  extracted_text text,

  -- Metadata
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_invoices_project ON invoices(project_id);
CREATE INDEX idx_invoices_status ON invoices(payment_status);
CREATE INDEX idx_invoices_vendor ON invoices(vendor_name);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);
CREATE INDEX idx_invoices_gmail_id ON invoices(gmail_message_id);

-- RLS
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices_select" ON invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "invoices_insert" ON invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "invoices_update" ON invoices FOR UPDATE TO authenticated USING (true);
CREATE POLICY "invoices_delete" ON invoices FOR DELETE TO authenticated USING (true);
