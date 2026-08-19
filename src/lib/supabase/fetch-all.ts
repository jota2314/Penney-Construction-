/**
 * Page through a PostgREST query until it runs dry.
 *
 * Supabase silently caps every request at 1000 rows (`db-max-rows`), so a
 * plain `.select()` on a table past that size returns a truncated result
 * with NO error — sums and aggregates computed from it are just wrong.
 * (This already bit gmail-sync dedup, /projects heat scores, the CEO
 * dashboard, and the estimating hub.)
 *
 * Pass a builder FACTORY, not a builder — PostgREST builders are single-use.
 * The factory must apply a stable `.order()` so pages don't overlap.
 *
 *   const rows = await fetchAllRows((from, to) =>
 *     supabase.from("invoices").select("id, amount").order("id").range(from, to)
 *   );
 */
const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  makePage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxRows = 50_000
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await makePage(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}
