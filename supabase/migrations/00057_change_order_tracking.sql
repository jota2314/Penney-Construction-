-- 00057_change_order_tracking.sql
-- Link invoices and estimate line items to change orders for budget-vs-actual tracking.

-- 1. Link invoices to change orders
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS change_order_id UUID REFERENCES change_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_change_order_id ON invoices(change_order_id);

-- 2. Link estimate line items to change orders (1 CO → 1 line item, optional)
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS change_order_id UUID REFERENCES change_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_estimate_line_items_change_order_id
  ON estimate_line_items(change_order_id);

-- 3. Budget vs actual view with CO awareness
CREATE OR REPLACE VIEW v_project_budget_actual AS
SELECT
  e.project_id,
  li.id            AS line_item_id,
  li.sort_order,
  li.trade,
  li.description,
  li.total_cost    AS budget,
  li.change_order_id,
  co.change_order_number,
  co.title         AS co_title,
  co.status        AS co_status,
  COALESCE(SUM(i.paid_amount), 0) AS paid,
  COALESCE(
    SUM(i.amount - COALESCE(i.paid_amount, 0))
      FILTER (WHERE i.payment_status = 'unpaid'),
    0
  ) AS committed_unpaid,
  li.total_cost - COALESCE(SUM(i.amount), 0) AS remaining
FROM estimate_line_items li
JOIN estimates e ON e.id = li.estimate_id
LEFT JOIN change_orders co ON co.id = li.change_order_id
LEFT JOIN invoices i ON i.estimate_line_item_id = li.id
GROUP BY e.project_id, li.id, li.sort_order, li.trade, li.description,
         li.total_cost, li.change_order_id, co.change_order_number,
         co.title, co.status;
