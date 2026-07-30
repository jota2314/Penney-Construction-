-- The budget views joined line items from EVERY estimate version, so any
-- project with more than one version showed each budget line once per
-- version (O'Mealia 2x, Breen 6x; 17 projects affected) and summed them all
-- into the budget total. Scope both views to the project's latest estimate
-- (highest version), matching resolveContractTotal and the Finances tab
-- header, which already label themselves off the version-desc-first estimate.
-- Applied to production 2026-07-30 as budget_views_latest_estimate_only.

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
    end as percent_spent
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
where e.id = (
    select e2.id from estimates e2
    where e2.project_id = e.project_id
    order by e2.version desc, e2.created_at desc
    limit 1
);

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
where e.id = (
    select e2.id from estimates e2
    where e2.project_id = e.project_id
    order by e2.version desc, e2.created_at desc
    limit 1
)
group by e.project_id, li.id, li.sort_order, li.trade, li.description, li.total_cost, li.change_order_id, co.change_order_number, co.title, co.status;
