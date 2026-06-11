/**
 * estimate_line_items carries TWO parallel financial column sets from a
 * stalled migration:
 *
 *   active : cost, markup_pct, client_price, profit      (nullable — authoritative)
 *   legacy : total_cost, markup_percentage, total_price  (NOT NULL, default 0)
 *
 * The DB trigger that rolls line items up into the estimates header
 * (migration 00086, sync_estimate_totals_from_lines) reads the active set
 * first, so any write that touches only the legacy set silently diverges
 * from the header totals — the "row shows $13,000 under a $23,400 subtotal"
 * bug. Until the legacy columns are dropped:
 *
 *   - every READ of a line's financials goes through lineCost / linePrice /
 *     lineMarkupPct (active first, legacy fallback), and
 *   - every WRITE spreads lineItemFinancials(...) so both sets stay in sync.
 */

export interface LineFinancialsRow {
  cost?: number | string | null;
  total_cost?: number | string | null;
  markup_pct?: number | string | null;
  markup_percentage?: number | string | null;
  client_price?: number | string | null;
  total_price?: number | string | null;
}

export function lineCost(li: LineFinancialsRow): number {
  return Number(li.cost ?? li.total_cost ?? 0);
}

export function linePrice(li: LineFinancialsRow): number {
  return Number(li.client_price ?? li.total_price ?? 0);
}

export function lineMarkupPct(li: LineFinancialsRow): number {
  return Number(li.markup_pct ?? li.markup_percentage ?? 0);
}

/**
 * Column payload that writes BOTH sets in sync. Spread into any
 * estimate_line_items insert/update that touches money.
 */
export function lineItemFinancials(cost: number, markupPct: number, clientPrice: number) {
  return {
    cost,
    total_cost: cost,
    markup_pct: markupPct,
    markup_percentage: markupPct,
    client_price: clientPrice,
    total_price: clientPrice,
    profit: clientPrice - cost,
  };
}
