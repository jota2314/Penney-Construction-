import type { PortalTimeMaterialEntry } from "./types";

export interface PortalTMRow {
  id: string;
  change_order_id: string;
  work_date: string;
  category: string;
  description: string;
  quantity: number | string;
  unit: string;
  unit_rate: number | string | null;
  amount: number | string | null;
  status: string;
  published_at: string | null;
  void_reason: string | null;
}

/** A second visibility check at the service-role boundary, before serialization. */
export function projectPortalTMEntries(
  rows: PortalTMRow[], changeOrderId: string, preview: boolean,
): PortalTimeMaterialEntry[] {
  return rows.flatMap((row) => {
    if (row.change_order_id !== changeOrderId) return [];
    const shared = !!row.published_at && (row.status === "published" || row.status === "void");
    if (!shared && !(preview && row.status === "draft")) return [];
    if (!["labor", "material", "equipment", "other"].includes(row.category)) return [];
    // Explicit projection: adding fields to the source table cannot expose them.
    return [{
      id: row.id,
      work_date: row.work_date,
      category: row.category as PortalTimeMaterialEntry["category"],
      description: row.description,
      quantity: Number(row.quantity),
      unit: row.unit,
      unit_rate: row.unit_rate == null ? null : Number(row.unit_rate),
      amount: row.amount == null ? null : Number(row.amount),
      status: row.status as PortalTimeMaterialEntry["status"],
      published_at: row.published_at,
      void_reason: row.status === "void" ? row.void_reason : null,
    }];
  });
}

export function summarizePortalTM(entries: PortalTimeMaterialEntry[]) {
  const shared = entries.filter((entry) => entry.status === "published");
  // Sum each saved line in cents; never include draft or void amounts.
  const sum = (rows: PortalTimeMaterialEntry[]) =>
    rows.reduce((total, entry) => total + Math.round((entry.amount ?? 0) * 100), 0) / 100;
  const categories = {
    labor: sum(shared.filter((entry) => entry.category === "labor")),
    material: sum(shared.filter((entry) => entry.category === "material")),
    equipment: sum(shared.filter((entry) => entry.category === "equipment")),
    other: sum(shared.filter((entry) => entry.category === "other")),
  };
  return {
    total: sum(shared),
    categories,
    hours: Math.round(shared
      .filter((entry) => entry.category === "labor" && /^(h|hr|hrs|hour|hours)$/i.test(entry.unit.trim()))
      .reduce((total, entry) => total + entry.quantity, 0) * 10000) / 10000,
    entryCount: shared.length,
    pendingRates: shared.filter((entry) => entry.unit_rate == null || entry.amount == null).length,
    draftCount: entries.filter((entry) => entry.status === "draft").length,
  };
}
