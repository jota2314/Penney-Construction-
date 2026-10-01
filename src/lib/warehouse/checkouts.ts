/**
 * Pure helpers for warehouse check-out / check-in and item photos. No
 * imports on purpose: scripts/warehouse-checkouts.test.mjs transpiles and
 * loads this file directly.
 */

/** Days out and dates are counted on the shop's clock, not the server's UTC. */
export const WAREHOUSE_TIME_ZONE = "America/New_York";

/** Rick's "flag anything out more than X days" — the choices offered. */
export const OVERDUE_DAY_OPTIONS = [7, 14, 30] as const;
export const DEFAULT_OVERDUE_DAYS = 14;

function shopDateKey(d: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: WAREHOUSE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Whole calendar days since checkout (0 = went out today). */
export function daysOut(checkedOutAt: string | Date, now: Date = new Date()): number {
  const out = Date.parse(`${shopDateKey(new Date(checkedOutAt))}T00:00:00Z`);
  const today = Date.parse(`${shopDateKey(now)}T00:00:00Z`);
  return Math.max(0, Math.round((today - out) / 86_400_000));
}

/** "Out more than X days". */
export function isOverdue(
  checkedOutAt: string | Date,
  thresholdDays: number,
  now: Date = new Date(),
): boolean {
  return daysOut(checkedOutAt, now) > thresholdDays;
}

export function daysOutLabel(days: number): string {
  if (days <= 0) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

/** 3 → "3", 2.5 → "2.5", 1.333 → "1.33". */
export function formatQty(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function formatShopDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: WAREHOUSE_TIME_ZONE,
    month: "short",
    day: "numeric",
  });
}

export function formatShopDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: WAREHOUSE_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Find the catalog item a scanned or typed code refers to: an exact barcode
 * first, then the SKU ("WH-0012", or just "12" off a shelf label).
 */
export function matchScanCode<T extends { barcode: string | null; sku: string }>(
  items: T[],
  raw: string,
): T | null {
  const code = raw.trim().toLowerCase();
  if (!code) return null;
  const byBarcode = items.find((i) => i.barcode?.trim().toLowerCase() === code);
  if (byBarcode) return byBarcode;
  const bySku = items.find((i) => i.sku.toLowerCase() === code);
  if (bySku) return bySku;
  if (/^\d{1,6}$/.test(code)) {
    const sku = `wh-${code.padStart(4, "0")}`;
    return items.find((i) => i.sku.toLowerCase() === sku) ?? null;
  }
  return null;
}

export interface CheckoutFacet {
  id: string;
  label: string;
  count: number;
}

/** The jobs and people that currently have something out, for the filters. */
export function checkoutFacets(
  rows: {
    project_id: string | null;
    project_name: string | null;
    employee_id: string | null;
    employee_name: string | null;
  }[],
): { jobs: CheckoutFacet[]; people: CheckoutFacet[] } {
  const jobs = new Map<string, CheckoutFacet>();
  const people = new Map<string, CheckoutFacet>();
  for (const r of rows) {
    const jobId = r.project_id ?? "none";
    const job = jobs.get(jobId) ?? { id: jobId, label: r.project_name ?? "No job", count: 0 };
    job.count += 1;
    jobs.set(jobId, job);

    const personId = r.employee_id ?? `name:${r.employee_name ?? "Unknown"}`;
    const person =
      people.get(personId) ?? { id: personId, label: r.employee_name ?? "Unknown", count: 0 };
    person.count += 1;
    people.set(personId, person);
  }
  const byLabel = (a: CheckoutFacet, b: CheckoutFacet) => a.label.localeCompare(b.label);
  return { jobs: [...jobs.values()].sort(byLabel), people: [...people.values()].sort(byLabel) };
}

/** Filter key for a row's person — matches the ids checkoutFacets hands out. */
export function checkoutPersonKey(r: {
  employee_id: string | null;
  employee_name: string | null;
}): string {
  return r.employee_id ?? `name:${r.employee_name ?? "Unknown"}`;
}

// ── Photos ─────────────────────────────────────────────────────────

/** Long edge of the stored photo and of the list thumbnail, in px. */
export const PHOTO_MAX_EDGE = 1600;
export const THUMB_MAX_EDGE = 320;

/**
 * Storage paths for a new photo. Everything for one item lives under
 * items/{itemId}/ so the server can confirm a submitted path belongs to the
 * item it is being attached to. The stamp makes every upload a new object,
 * so a replaced photo never serves a stale cached copy.
 */
export function warehousePhotoPaths(
  itemId: string,
  stamp: string,
): { photo: string; thumb: string } {
  return {
    photo: `items/${itemId}/${stamp}.jpg`,
    thumb: `items/${itemId}/${stamp}_thumb.jpg`,
  };
}

export function isWarehousePhotoPathFor(itemId: string, path: string | null | undefined): boolean {
  if (!path) return false;
  const prefix = `items/${itemId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return /^[A-Za-z0-9_-]+\.jpg$/.test(rest);
}
