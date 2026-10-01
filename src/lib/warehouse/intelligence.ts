import type { MaterialOrderWithItems, WarehouseItem, WarehouseOpenCheckout, WarehouseTransaction } from "@/types/database";

export interface WarehouseSnapshot {
  items: WarehouseItem[];
  orders: MaterialOrderWithItems[];
  checkouts: WarehouseOpenCheckout[];
  transactions: WarehouseTransaction[];
  capturedAt: string;
  activitySince: string;
  warnings: string[];
}

export interface WarehouseAction {
  id: string;
  priority: "urgent" | "review" | "info";
  title: string;
  detail: string;
  href: string;
  action: string;
}

export function shopDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Only unpicked approved demand consumes planned stock, including partial ready orders. */
export function buildWarehouseInsights(snapshot: WarehouseSnapshot) {
  const { items, orders, checkouts, transactions } = snapshot;
  const today = shopDay(snapshot.capturedAt);
  const demand = new Map<string, number>();
  for (const order of orders.filter(o => o.status === "approved" || o.status === "ready")) {
    for (const line of order.material_order_items) {
      const item = items.find(i => i.id === line.item_id);
      if (item && item.unit.toLowerCase() === line.unit.toLowerCase()) {
        demand.set(item.id, (demand.get(item.id) ?? 0) + Math.max(0, Number(line.quantity) - Number(line.quantity_fulfilled)));
      }
    }
  }
  const actions: WarehouseAction[] = [];
  for (const order of orders) {
    const late = !!order.needed_by && order.needed_by.slice(0, 10) < today;
    const unverified = order.material_order_items.filter(l => !l.item_id || !items.some(i => i.id === l.item_id && i.unit.toLowerCase() === l.unit.toLowerCase()));
    const remaining = order.status === "ready" ? order.material_order_items.filter(l => Number(l.quantity_fulfilled) < Number(l.quantity)).length : 0;
    actions.push({
      id: `order:${order.id}`, priority: late || order.priority === "urgent" ? "urgent" : "review",
      title: `${order.order_number}: ${order.status === "pending" ? "Review request" : order.status === "ready" ? remaining ? "Resolve incomplete pick" : "Arrange handoff" : "Prepare pick list"}`,
      detail: `${order.projects?.name ?? "No job linked"} · Requested by ${order.requested_by_name ?? "unknown"}${order.needed_by ? ` · Needed ${order.needed_by.slice(0, 10)}${late ? " (past due)" : ""}` : " · Needed date missing"}${unverified.length ? ` · ${unverified.length} lines need catalog/unit verification` : ""}${remaining ? ` · ${remaining} lines are not fully fulfilled; confirm the remainder before handoff` : ""}`,
      href: `/warehouse/orders/${order.id}`, action: "Open request",
    });
  }
  const stock = items.map(item => {
    const approvedDemand = demand.get(item.id) ?? 0;
    const availableAfterDemand = Number(item.quantity_on_hand) - approvedDemand;
    const shortage = Math.max(0, -availableAfterDemand);
    const out = checkouts.filter(c => c.item_id === item.id).reduce((n, c) => n + Number(c.quantity_outstanding), 0);
    // A default zero reorder point is not a buying policy.
    const replenish = Number(item.reorder_point) > 0 && availableAfterDemand <= Number(item.reorder_point);
    const suggestedQuantity = shortage || replenish
      ? Math.max(shortage, Number(item.reorder_quantity) || 0, Number(item.reorder_point) - availableAfterDemand)
      : 0;
    if (shortage || replenish || Number(item.quantity_on_hand) === 0) {
      actions.push({ id: `stock:${item.id}`, priority: shortage ? "urgent" : "review",
        title: shortage ? `${item.name}: ${shortage} ${item.unit} short` : `${item.name}: ${out ? "check stock out on jobs" : "review stock"}`,
        detail: `${item.quantity_on_hand} ${item.unit} on shelf · ${approvedDemand} approved demand · ${out} out on jobs.${suggestedQuantity ? ` Suggested replenishment: ${suggestedQuantity} ${item.unit}; confirm returns and need first.` : " Confirm need before reordering; no replenishment target is configured."}`,
        href: `/warehouse/items/${item.id}`, action: "Review material" });
    }
    return { itemId: item.id, approvedDemand, availableAfterDemand, shortage, suggestedQuantity, out };
  });
  for (const checkout of checkouts) {
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${shopDay(checkout.checked_out_at)}T00:00:00Z`)) / 86400000);
    if (days > 14) actions.push({ id: `checkout:${checkout.id}`, priority: "review", title: `${checkout.item_name}: out ${days} days`,
      detail: `${checkout.quantity_outstanding} ${checkout.unit} with ${checkout.employee_name ?? "person not recorded"} · ${checkout.project_name ?? "job not recorded"}. Confirm still needed, returned, or used.`,
      href: "/warehouse/out", action: "Review checkout" });
  }
  const missingDescription = items.filter(i => !i.description?.trim());
  if (missingDescription.length) actions.push({ id: "knowledge", priority: "info", title: `${missingDescription.length} materials need identification details`, detail: "Record size, model, condition, intended use and compatibility from the label or manufacturer. Start with the first incomplete item.", href: `/warehouse/items/${missingDescription[0].id}`, action: "Improve catalog" });
  const people = new Map<string, { id: string; name: string; movements: number; lastAt: string }>();
  for (const t of transactions) {
    // Never guess that two names belong to the same person when there is no ID.
    const id = t.performed_by ?? `unlinked:${t.performed_by_name ?? "unknown"}`;
    const person = people.get(id) ?? { id, name: t.performed_by_name ?? "Logger not recorded", movements: 0, lastAt: t.created_at };
    person.movements += 1;
    if (t.created_at > person.lastAt) person.lastAt = t.created_at;
    people.set(id, person);
  }
  const rank = { urgent: 0, review: 1, info: 2 };
  actions.sort((a, b) => rank[a.priority] - rank[b.priority] || a.title.localeCompare(b.title));
  return { actions, stock, people: [...people.values()].sort((a, b) => b.movements - a.movements), missingDescription: missingDescription.length };
}

/** Broader literal search includes the material's knowledge, not only its label. */
export function matchesMaterial(item: WarehouseItem, query: string): boolean {
  const haystack = [item.name, item.sku, item.description, item.notes, item.category, item.vendor, item.location, item.barcode].filter(Boolean).join(" ").toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every(word => haystack.includes(word));
}
