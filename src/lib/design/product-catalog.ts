import { z } from "zod";

export const catalogProductSchema = z.object({
  id: z.string().min(1), category: z.string(), name: z.string(), model: z.string(),
  finish: z.string(), dimensions: z.string(), unit_price: z.number().nonnegative().nullable(),
  price_basis: z.string(), price_unit: z.string(), currency: z.literal("USD"),
  checked_date: z.string(), source_url: z.string(), notes: z.string(), status: z.string(),
  image: z.string().nullable().optional(), imageUrl: z.string().nullable().optional(),
  spec_url: z.string().nullable().optional(), brand: z.string().optional(),
}).catchall(z.unknown());
export const catalogSchema = z.object({ updatedAt: z.string(), products: z.array(catalogProductSchema) });
export type CatalogProduct = z.infer<typeof catalogProductSchema>;

export function safeProductUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try { const url = new URL(value); if (url.protocol === "https:") return url.href; } catch { /* missing source */ }
}

export function categoryLabel(category: string) {
  const labels: Record<string, string> = { vanity: "Vanities", vanities: "Vanities", tile: "Tile", tub: "Tubs & drains", toilets: "Toilets & seats", faucets: "Faucets & valves", plumbing: "Faucets & valves", lighting: "Lighting", mirrors: "Mirrors", accessories: "Accessories" };
  Object.assign(labels, { "rough valves": "Faucets & valves", "shower trim": "Faucets & valves", "toilet seats": "Toilets & seats", "sinks and tops": "Sinks & tops", fittings: "Accessories" });
  return labels[category.toLowerCase()] ?? category;
}

export function filterProducts(products: CatalogProduct[], query: string, category: string, sort: string) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const result = products.filter(p => (category === "All" || categoryLabel(p.category) === category) && words.every(w => JSON.stringify(p).toLowerCase().includes(w)));
  return result.sort((a, b) => sort === "price-low" ? (a.unit_price ?? Infinity) - (b.unit_price ?? Infinity) : sort === "price-high" ? (b.unit_price ?? -Infinity) - (a.unit_price ?? -Infinity) : a.name.localeCompare(b.name));
}
