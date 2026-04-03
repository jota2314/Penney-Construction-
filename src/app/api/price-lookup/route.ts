import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/price-lookup?category=plumbing&q=toilet
 * Searches the price book for matching items.
 * Returns price history with supplier info and averages.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const q = searchParams.get("q");
  const trade = searchParams.get("trade"); // alias for category

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let query = supabase
    .from("price_book")
    .select("*")
    .order("quote_date", { ascending: false })
    .limit(50);

  if (category || trade) {
    query = query.eq("category", category || trade);
  }

  if (q) {
    query = query.ilike("item_name", `%${q}%`);
  }

  const { data: items, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Group by item_name and calculate averages
  const grouped = new Map<string, {
    item_name: string;
    category: string;
    unit_type: string;
    entries: typeof items;
    avg_price: number;
    min_price: number;
    max_price: number;
    latest_price: number;
    latest_supplier: string;
    latest_date: string | null;
    count: number;
  }>();

  for (const item of items ?? []) {
    const key = item.item_name.toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, {
        item_name: item.item_name,
        category: item.category,
        unit_type: item.unit_type,
        entries: [],
        avg_price: 0,
        min_price: Infinity,
        max_price: 0,
        latest_price: item.unit_price,
        latest_supplier: item.supplier_name,
        latest_date: item.quote_date,
        count: 0,
      });
    }
    const g = grouped.get(key)!;
    g.entries.push(item);
    g.count++;
    g.min_price = Math.min(g.min_price, item.unit_price);
    g.max_price = Math.max(g.max_price, item.unit_price);
    g.avg_price = g.entries.reduce((s, e) => s + e.unit_price, 0) / g.count;
  }

  // Also get trade_rates as fallback for items not in price book
  const { data: tradeRates } = await supabase
    .from("trade_rates")
    .select("trade_name, description, unit_type, avg_cost, avg_price")
    .eq("is_active", true);

  return NextResponse.json({
    items: Array.from(grouped.values()),
    trade_rates: tradeRates ?? [],
    total: (items ?? []).length,
  });
}
