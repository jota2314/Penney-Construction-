-- Live project financials: one call returns full P&L per project
CREATE OR REPLACE FUNCTION get_project_financials(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH
  -- Project base data
  project_data AS (
    SELECT
      COALESCE(p.contract_value, 0) as contract_value,
      COALESCE(p.estimated_value, 0) as estimated_value
    FROM projects p
    WHERE p.id = p_project_id
  ),

  -- Budget from latest approved estimate (or latest draft if none approved)
  budget AS (
    SELECT
      COALESCE(SUM(eli.total_cost), 0) as total_budgeted_cost,
      COALESCE(SUM(eli.client_price), 0) as total_budgeted_price,
      COALESCE(SUM(eli.profit), 0) as total_budgeted_profit,
      e.id as estimate_id
    FROM estimates e
    JOIN estimate_line_items eli ON eli.estimate_id = e.id
    WHERE e.project_id = p_project_id
    AND e.version = (
      SELECT MAX(e2.version) FROM estimates e2
      WHERE e2.project_id = p_project_id
      AND e2.status IN ('approved', 'draft')
    )
    GROUP BY e.id
  ),

  -- Actual costs: invoices
  invoice_totals AS (
    SELECT
      COALESCE(SUM(i.amount), 0) as total_invoiced,
      COALESCE(SUM(CASE WHEN i.payment_status = 'paid' THEN i.paid_amount ELSE 0 END), 0) as total_paid_to_vendors,
      COALESCE(SUM(CASE WHEN i.payment_status = 'unpaid' THEN i.amount ELSE 0 END), 0) as total_unpaid
    FROM invoices i
    WHERE i.project_id = p_project_id
  ),

  -- Actual costs: labor (from time entries)
  labor AS (
    SELECT
      COALESCE(SUM(
        (EXTRACT(EPOCH FROM (te.clock_out - te.clock_in)) / 3600.0
         - COALESCE(te.break_minutes, 0) / 60.0)
        * emp.hourly_rate
      ), 0) as total_labor_cost,
      COALESCE(SUM(
        EXTRACT(EPOCH FROM (te.clock_out - te.clock_in)) / 3600.0
        - COALESCE(te.break_minutes, 0) / 60.0
      ), 0) as total_hours
    FROM time_entries te
    JOIN employees emp ON te.employee_id = emp.id
    WHERE te.project_id = p_project_id
    AND te.clock_out IS NOT NULL
  ),

  -- Money in: client payments
  payments AS (
    SELECT
      COALESCE(SUM(pr.amount), 0) as total_received,
      COALESCE(SUM(CASE WHEN pr.payment_type = 'deposit' THEN pr.amount ELSE 0 END), 0) as deposit_received,
      COALESCE(SUM(CASE WHEN pr.payment_type IN ('draw', 'progress') THEN pr.amount ELSE 0 END), 0) as draws_received,
      COALESCE(SUM(CASE WHEN pr.payment_type = 'final' THEN pr.amount ELSE 0 END), 0) as final_received
    FROM payments_received pr
    WHERE pr.project_id = p_project_id
  ),

  -- Change orders (approved only)
  changes AS (
    SELECT
      COUNT(*) as co_count,
      COALESCE(SUM(co.cost_impact), 0) as total_co_cost,
      COALESCE(SUM(co.price_impact), 0) as total_co_price
    FROM change_orders co
    WHERE co.project_id = p_project_id
    AND co.status = 'approved'
  )

  SELECT jsonb_build_object(
    -- Contract
    'contract_value', pd.contract_value,
    'estimated_value', pd.estimated_value,
    'adjusted_contract', pd.contract_value + c.total_co_price,

    -- Budget (from estimate)
    'budget_cost', b.total_budgeted_cost,
    'budget_price', b.total_budgeted_price,
    'budget_profit', b.total_budgeted_profit,
    'estimate_id', b.estimate_id,

    -- Actual costs
    'actual_invoiced', it.total_invoiced,
    'actual_paid_vendors', it.total_paid_to_vendors,
    'actual_unpaid', it.total_unpaid,
    'actual_labor_cost', l.total_labor_cost,
    'actual_labor_hours', ROUND(l.total_hours::numeric, 1),
    'total_actual_cost', it.total_invoiced + l.total_labor_cost,

    -- Budget remaining
    'budget_remaining', b.total_budgeted_cost - (it.total_invoiced + l.total_labor_cost),
    'percent_budget_spent', CASE
      WHEN b.total_budgeted_cost > 0
      THEN ROUND(((it.total_invoiced + l.total_labor_cost) / b.total_budgeted_cost * 100)::numeric, 1)
      ELSE 0
    END,

    -- Revenue (money in)
    'total_payments_received', p.total_received,
    'deposit_received', p.deposit_received,
    'draws_received', p.draws_received,
    'final_received', p.final_received,
    'outstanding_receivable', (pd.contract_value + c.total_co_price) - p.total_received,

    -- Change orders
    'change_order_count', c.co_count,
    'change_order_cost', c.total_co_cost,
    'change_order_revenue', c.total_co_price,

    -- Live P&L
    'gross_profit', p.total_received - (it.total_paid_to_vendors + l.total_labor_cost),
    'projected_profit', (pd.contract_value + c.total_co_price) - (b.total_budgeted_cost + c.total_co_cost),
    'margin_percent', CASE
      WHEN (pd.contract_value + c.total_co_price) > 0
      THEN ROUND((((pd.contract_value + c.total_co_price) - (b.total_budgeted_cost + c.total_co_cost))
            / (pd.contract_value + c.total_co_price) * 100)::numeric, 1)
      ELSE 0
    END
  ) INTO result
  FROM project_data pd, budget b, invoice_totals it, labor l, payments p, changes c;

  -- If no estimate exists, return zeros with just project data
  IF result IS NULL THEN
    SELECT jsonb_build_object(
      'contract_value', COALESCE(p.contract_value, 0),
      'estimated_value', COALESCE(p.estimated_value, 0),
      'adjusted_contract', COALESCE(p.contract_value, 0),
      'budget_cost', 0, 'budget_price', 0, 'budget_profit', 0, 'estimate_id', null,
      'actual_invoiced', 0, 'actual_paid_vendors', 0, 'actual_unpaid', 0,
      'actual_labor_cost', 0, 'actual_labor_hours', 0, 'total_actual_cost', 0,
      'budget_remaining', 0, 'percent_budget_spent', 0,
      'total_payments_received', 0, 'deposit_received', 0, 'draws_received', 0, 'final_received', 0,
      'outstanding_receivable', COALESCE(p.contract_value, 0),
      'change_order_count', 0, 'change_order_cost', 0, 'change_order_revenue', 0,
      'gross_profit', 0, 'projected_profit', 0, 'margin_percent', 0
    ) INTO result
    FROM projects p WHERE p.id = p_project_id;
  END IF;

  RETURN result;
END;
$$;

-- Per-line-item budget vs actual view
CREATE OR REPLACE VIEW budget_vs_actual AS
SELECT
  eli.id as line_item_id,
  eli.estimate_id,
  e.project_id,
  eli.description,
  eli.trade,
  eli.sort_order,
  COALESCE(eli.total_cost, eli.cost, 0) as budgeted_cost,
  COALESCE(eli.client_price, eli.total_price, 0) as budgeted_price,
  COALESCE(eli.profit, 0) as budgeted_profit,
  COALESCE(inv.invoiced_amount, 0) as actual_invoiced,
  COALESCE(inv.paid_amount, 0) as actual_paid,
  COALESCE(eli.total_cost, eli.cost, 0) - COALESCE(inv.invoiced_amount, 0) as variance,
  CASE
    WHEN COALESCE(eli.total_cost, eli.cost, 0) > 0
    THEN ROUND((COALESCE(inv.invoiced_amount, 0) / COALESCE(eli.total_cost, eli.cost, 0) * 100)::numeric, 1)
    ELSE 0
  END as percent_spent
FROM estimate_line_items eli
JOIN estimates e ON eli.estimate_id = e.id
LEFT JOIN (
  SELECT
    i.estimate_line_item_id,
    SUM(i.amount) as invoiced_amount,
    SUM(i.paid_amount) as paid_amount
  FROM invoices i
  WHERE i.estimate_line_item_id IS NOT NULL
  GROUP BY i.estimate_line_item_id
) inv ON inv.estimate_line_item_id = eli.id;
