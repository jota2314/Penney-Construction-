-- Section headers (ELECTRICAL, KITCHEN, ...) are organizational rows in the
-- estimate, not budget lines — resolveContractTotal has always skipped them.
-- budget_vs_actual now exposes the flag so the Finances tab renders them as
-- section dividers instead of $0 money rows; v_project_budget_actual (line
-- pickers / actuals) drops them entirely. Verified 2026-07-30: zero invoices
-- and zero schedule phases reference a header row. Applied to production
-- 2026-07-30 as budget_views_section_headers. These are the current full
-- definitions of both views (scoped to current_estimate_id per 00114).

create or replace view public.budget_vs_actual with (security_invoker = on) as
select
    eli.id as line_item_id,
    eli.estimate_id,
    e.project_id,
    eli.description,
    eli.trade,
    eli.sort_order,
    coalesce(eli.total_cost, eli.cost, 0::numeric) as budgeted_cost,
    coalesce(eli.client_price, eli.total_price, 0::numeric) as budgeted_price,
    coalesce(eli.profit, 0::numeric) as budgeted_profit,
    coalesce(inv.invoiced_amount, 0::numeric) as actual_invoiced,
    coalesce(inv.paid_amount, 0::numeric) as actual_paid,
    coalesce(eli.total_cost, eli.cost, 0::numeric) - coalesce(inv.invoiced_amount, 0::numeric) as variance,
    case
        when coalesce(eli.total_cost, eli.cost, 0::numeric) > 0::numeric
        then round(coalesce(inv.invoiced_amount, 0::numeric) / coalesce(eli.total_cost, eli.cost, 0::numeric) * 100::numeric, 1)
        else 0::numeric
    end as percent_spent,
    coalesce(eli.is_section_header, false) as is_section_header
from estimate_line_items eli
join estimates e on eli.estimate_id = e.id
left join (
    select i.estimate_line_item_id,
        sum(i.amount) as invoiced_amount,
        sum(i.paid_amount) as paid_amount
    from invoices i
    where i.estimate_line_item_id is not null
    group by i.estimate_line_item_id
) inv on inv.estimate_line_item_id = eli.id
where e.id = public.current_estimate_id(e.project_id);

create or replace view public.v_project_budget_actual with (security_invoker = on) as
select e.project_id,
    li.id as line_item_id,
    li.sort_order,
    li.trade,
    li.description,
    li.total_cost as budget,
    li.change_order_id,
    co.change_order_number,
    co.title as co_title,
    co.status as co_status,
    coalesce(sum(i.paid_amount), 0::numeric) as paid,
    coalesce(sum(i.amount - coalesce(i.paid_amount, 0::numeric)) filter (where i.payment_status = 'unpaid'::text), 0::numeric) as committed_unpaid,
    li.total_cost - coalesce(sum(i.amount), 0::numeric) as remaining
from estimate_line_items li
join estimates e on e.id = li.estimate_id
left join change_orders co on co.id = li.change_order_id
left join invoices i on i.estimate_line_item_id = li.id
where e.id = public.current_estimate_id(e.project_id)
  and li.is_section_header is not true
group by e.project_id, li.id, li.sort_order, li.trade, li.description, li.total_cost, li.change_order_id, co.change_order_number, co.title, co.status;
