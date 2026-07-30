/**
 * The one rule for "which estimate is the project's current one" — the TS
 * mirror of current_estimate_id() in migration 00114, for code that already
 * holds the estimates list: the stamped contract estimate wins, then the
 * highest live version, then the highest version of any status.
 *
 * Every reader must use this (or the SQL function) instead of estimates[0].
 * Readers that pick on their own is how the version-double-count bug class
 * kept coming back — see supabase/migrations/00113 and 00114.
 */
export function pickCurrentEstimate<T extends { id: string; status?: string | null }>(
  /** Must be ordered version DESC, the way every page already fetches them. */
  estimates: T[],
  contractEstimateId?: string | null,
): T | null {
  if (contractEstimateId) {
    const stamped = estimates.find((e) => e.id === contractEstimateId);
    if (stamped) return stamped;
  }
  return (
    estimates.find((e) => e.status !== "superseded" && e.status !== "rejected") ??
    estimates[0] ??
    null
  );
}
