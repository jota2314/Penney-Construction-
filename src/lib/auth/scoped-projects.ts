import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/types/auth";

/**
 * Project visibility scoping hook. PMs see EVERY project (Jorge, 7/21) — a
 * PM runs jobs across the whole board, so project lists are unscoped for all
 * office roles and this always returns null ("no filtering"). What a PM
 * still can't reach is enforced elsewhere: blocked routes in canAccessPath
 * (company financials, estimating, reviews, /ceo, estimate/pricing/bids
 * project sub-pages) and pay-rate masking in rate-visibility.
 *
 * Kept as the single choke point should per-role scoping ever come back —
 * every project list already calls it.
 */
export async function getScopedProjectIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _supabase: SupabaseClient<any, any, any>,
  _profile: UserProfile | null,
): Promise<Set<string> | null> {
  return null;
}
