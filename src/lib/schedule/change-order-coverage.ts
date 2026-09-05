/** Only an explicit master-phase link counts as scheduling added scope. */
export function uncoveredChangeOrders<CO extends { id: string; status: string }>(
  orders: CO[],
  lines: { id: string; change_order_id?: string | null }[],
  phases: { estimate_line_item_id?: string | null; phase_scope?: string | null }[],
) {
  const linked = new Set(phases.filter(p => p.phase_scope !== "daily").map(p => p.estimate_line_item_id));
  return orders.filter(co => co.status === "approved").flatMap(co => {
    const scope = lines.filter(l => l.change_order_id === co.id);
    const missing = scope.filter(l => !linked.has(l.id));
    return !scope.length || missing.length ? [{ ...co, missingLineIds: missing.map(l => l.id), noBudgetLink: !scope.length }] : [];
  });
}
