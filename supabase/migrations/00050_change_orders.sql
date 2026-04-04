-- Track scope/cost changes during construction
CREATE TABLE change_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  estimate_id uuid REFERENCES estimates(id) ON DELETE SET NULL,

  -- Change order identity
  change_order_number integer NOT NULL,
  title text NOT NULL,
  description text,

  -- Status
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'void')),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by text,  -- client name

  -- Financial impact
  cost_impact numeric(12,2) DEFAULT 0,   -- what it costs US (internal)
  price_impact numeric(12,2) DEFAULT 0,  -- what we charge the CLIENT

  -- Links
  gmail_message_id text,
  attachment_storage_path text,

  -- Metadata
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(project_id, change_order_number)
);

CREATE INDEX idx_change_orders_project ON change_orders(project_id);
CREATE INDEX idx_change_orders_status ON change_orders(status);

-- Now add the FK from payments_received to change_orders
ALTER TABLE payments_received
  ADD CONSTRAINT fk_payments_change_order
  FOREIGN KEY (change_order_id) REFERENCES change_orders(id) ON DELETE SET NULL;

-- RLS
ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "change_orders_select" ON change_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "change_orders_insert" ON change_orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "change_orders_update" ON change_orders FOR UPDATE TO authenticated USING (true);
CREATE POLICY "change_orders_delete" ON change_orders FOR DELETE TO authenticated USING (true);
