-- Applied live 2026-07-29.
--
-- get_project_financials picked its budget from
--   MAX(version) WHERE status IN ('approved','draft')
-- the same approved/draft filter that was removed from the application code in
-- src/lib/estimates/current-estimate.ts. A sent or accepted estimate IS the
-- contracted one, and this excluded it:
--
--   Caraglia  (PC-2026-118, in_progress) budgeted off v3 "Option C" $58,612.20
--                                        instead of the accepted v4 $53,585.25
--   Frechette (PC-2026-139, contracted)  budgeted off v1 $96,862.00
--                                        instead of the sent v2 $79,066.60
--
-- Worse, when a project's ONLY estimate is sent/accepted/review the subquery
-- returned NULL, the budget CTE produced no row, the whole SELECT collapsed to
-- NULL, and the function fell through to its "no estimate exists" branch:
-- budget_cost 0, budget_price 0, margin 0, projected_profit = the entire
-- contract. Ten live jobs read that way, including Parziale ($114,727 accepted,
-- in progress -> now correctly 22.2% margin) and Cappucci ADU ($319,311.72).
--
-- Budget now comes from the project's CURRENT estimate, defined exactly as in
-- src/lib/estimates/current-estimate.ts: highest version that is not
-- rejected/superseded, created_at breaking ties. Keep the two in step.
--
-- The budget CTE is also made total (LEFT JOIN + a guaranteed row) so a missing
-- or empty estimate zeroes only the budget, instead of nulling out contract
-- value, payments and change orders along with it.

-- Authoritative function body (matches what is live):

CREATE OR REPLACE FUNCTION public.get_project_financials(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  v_estimate_id uuid;
BEGIN
  -- The project's current estimate — same rule as the app's resolver.
  SELECT e.id INTO v_estimate_id
  FROM estimates e
  WHERE e.project_id = p_project_id
    AND e.status NOT IN ('rejected', 'superseded')
  ORDER BY e.version DESC, e.created_at DESC
  LIMIT 1;

  WITH
  project_data AS (
    SELECT
      COALESCE(p.contract_value, 0) as contract_value,
      COALESCE(p.estimated_value, 0) as estimated_value
    FROM projects p
    WHERE p.id = p_project_id
  ),

  -- Always one row, even when there is no estimate or it has no lines.
  budget AS (
    SELECT
      COALESCE(SUM(eli.total_cost), 0) as total_budgeted_cost,
      COALESCE(SUM(eli.client_price), 0) as total_budgeted_price,
      COALESCE(SUM(eli.profit), 0) as total_budgeted_profit,
      v_estimate_id as estimate_id
    FROM (SELECT 1) one
    LEFT JOIN estimate_line_items eli
      ON v_estimate_id IS NOT NULL AND eli.estimate_id = v_estimate_id
  ),

  invoice_totals AS (
    SELECT
      COALESCE(SUM(i.amount), 0) as total_invoiced,
      COALESCE(SUM(CASE WHEN i.payment_status = 'paid' THEN i.paid_amount ELSE 0 END), 0) as total_paid_to_vendors,
      COALESCE(SUM(CASE WHEN i.payment_status = 'unpaid' THEN i.amount ELSE 0 END), 0) as total_unpaid
    FROM invoices i
    WHERE i.project_id = p_project_id
  ),

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

  payments AS (
    SELECT
      COALESCE(SUM(pr.amount), 0) as total_received,
      COALESCE(SUM(CASE WHEN pr.payment_type = 'deposit' THEN pr.amount ELSE 0 END), 0) as deposit_received,
      COALESCE(SUM(CASE WHEN pr.payment_type IN ('draw', 'progress') THEN pr.amount ELSE 0 END), 0) as draws_received,
      COALESCE(SUM(CASE WHEN pr.payment_type = 'final' THEN pr.amount ELSE 0 END), 0) as final_received
    FROM payments_received pr
    WHERE pr.project_id = p_project_id
  ),

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
    'contract_value', pd.contract_value,
    'estimated_value', pd.estimated_value,
    'adjusted_contract', pd.contract_value + c.total_co_price,

    'budget_cost', b.total_budgeted_cost,
    'budget_price', b.total_budgeted_price,
    'budget_profit', b.total_budgeted_profit,
    'estimate_id', b.estimate_id,

    'actual_invoiced', it.total_invoiced,
    'actual_paid_vendors', it.total_paid_to_vendors,
    'actual_unpaid', it.total_unpaid,
    'actual_labor_cost', l.total_labor_cost,
    'actual_labor_hours', ROUND(l.total_hours::numeric, 1),
    'total_actual_cost', it.total_invoiced + l.total_labor_cost,

    'budget_remaining', b.total_budgeted_cost - (it.total_invoiced + l.total_labor_cost),
    'percent_budget_spent', CASE
      WHEN b.total_budgeted_cost > 0
      THEN ROUND(((it.total_invoiced + l.total_labor_cost) / b.total_budgeted_cost * 100)::numeric, 1)
      ELSE 0
    END,

    'total_payments_received', p.total_received,
    'deposit_received', p.deposit_received,
    'draws_received', p.draws_received,
    'final_received', p.final_received,
    'outstanding_receivable', (pd.contract_value + c.total_co_price) - p.total_received,

    'change_order_count', c.co_count,
    'change_order_cost', c.total_co_cost,
    'change_order_revenue', c.total_co_price,

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

  RETURN result;
END;
$function$;
