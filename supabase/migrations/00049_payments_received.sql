-- Track money coming IN from clients (deposits, draws, progress payments, final)
CREATE TABLE payments_received (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Payment details
  payment_type text NOT NULL CHECK (payment_type IN ('deposit', 'draw', 'progress', 'final', 'change_order', 'retainage', 'other')),
  description text,
  amount numeric(12,2) NOT NULL,
  received_date date NOT NULL DEFAULT CURRENT_DATE,

  -- Method & reference
  method text CHECK (method IN ('check', 'wire', 'ach', 'credit_card', 'cash', 'zelle', 'other')),
  reference_number text,

  -- Links
  change_order_id uuid,  -- FK added after change_orders table exists
  gmail_message_id text,
  invoice_sent_number text,  -- our invoice number to the client

  -- Metadata
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_payments_received_project ON payments_received(project_id);
CREATE INDEX idx_payments_received_date ON payments_received(received_date);
CREATE INDEX idx_payments_received_type ON payments_received(payment_type);

-- RLS
ALTER TABLE payments_received ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_received_select" ON payments_received FOR SELECT TO authenticated USING (true);
CREATE POLICY "payments_received_insert" ON payments_received FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "payments_received_update" ON payments_received FOR UPDATE TO authenticated USING (true);
CREATE POLICY "payments_received_delete" ON payments_received FOR DELETE TO authenticated USING (true);
