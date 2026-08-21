-- 00127: Surface the close-out/lock state on budget_vs_actual.
--
-- Migration 00126 added is_locked + the closed_* snapshot to
-- estimate_line_items, but the Line Item Lifecycle panel on the project
-- Finances tab reads budget_vs_actual, not the line table. The page selects
-- `*` from this view, so adding the columns here carries them all the way to
-- the UI with no query change.
--
-- Definition is otherwise byte-identical to the existing view -- only the
-- three trailing columns are new.

create or replace view public.budget_vs_actual as
 SELECT eli.id AS line_item_id,
    eli.estimate_id,
    e.project_id,
    eli.description,
    eli.trade,
    eli.sort_order,
    COALESCE(eli.total_cost, eli.cost, 0::numeric) AS budgeted_cost,
    COALESCE(eli.client_price, eli.total_price, 0::numeric) AS budgeted_price,
    COALESCE(eli.profit, 0::numeric) AS budgeted_profit,
    COALESCE(inv.invoiced_amount, 0::numeric) AS actual_invoiced,
    COALESCE(inv.paid_amount, 0::numeric) AS actual_paid,
    COALESCE(eli.total_cost, eli.cost, 0::numeric) - COALESCE(inv.invoiced_amount, 0::numeric) AS variance,
        CASE
            WHEN COALESCE(eli.total_cost, eli.cost, 0::numeric) > 0::numeric THEN round(COALESCE(inv.invoiced_amount, 0::numeric) / COALESCE(eli.total_cost, eli.cost, 0::numeric) * 100::numeric, 1)
            ELSE 0::numeric
        END AS percent_spent,
    COALESCE(eli.is_section_header, false) AS is_section_header,
    COALESCE(eli.is_locked, false) AS is_locked,
    eli.closed_at,
    eli.closed_margin
   FROM estimate_line_items eli
     JOIN estimates e ON eli.estimate_id = e.id
     LEFT JOIN ( SELECT i.estimate_line_item_id,
            sum(i.amount) AS invoiced_amount,
            sum(i.paid_amount) AS paid_amount
           FROM invoices i
          WHERE i.estimate_line_item_id IS NOT NULL
          GROUP BY i.estimate_line_item_id) inv ON inv.estimate_line_item_id = eli.id
  WHERE e.id = current_estimate_id(e.project_id);
