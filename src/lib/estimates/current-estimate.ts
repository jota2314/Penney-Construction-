/**
 * ONE definition of "which estimate is this project's estimate".
 *
 * Before this module there were three competing rules spread across ~24 call
 * sites, and they disagreed with each other:
 *
 *   A. newest version, any status
 *        -> projects/[id]/page.tsx, budget, generate-contract, proposal PDF
 *   B. newest version WHERE status IN ('approved','draft')
 *        -> quote-coverage, split-invoice, auto-link-invoices, bid package,
 *           suggest-payment-schedule, financial report, permit description, ...
 *   C. newest by created_at (not version!) WHERE status IN ('approved','draft')
 *        -> crew/field-capture
 *
 * Rule B silently drops an estimate the moment it is sent or accepted — i.e.
 * exactly when it becomes the real contract. Caraglia (PC-2026-118) is the
 * case in point: v4 is `accepted` at $53,585.25, so rule B fell back to the
 * superseded v3 "Option C" at $58,612.20. Same 23 descriptions, different
 * money, depending on which screen you opened. Frechette and Tkaczuk had the
 * same split. That is the "duplicate line items" report — not duplicate rows,
 * two different estimates rendered as if both were current.
 *
 * Two functions, because reading and writing genuinely differ:
 *
 *   getCurrentEstimateId  - what the project IS. Newest live version whatever
 *                           its status. Use for display, totals, PDFs,
 *                           coverage, invoice/quote splitting, suggestions.
 *   getWritableEstimateId - what you may APPEND TO. Newest draft/approved
 *                           version, because mutating a sent or accepted
 *                           estimate rewrites a document the client already
 *                           holds. Callers should create a new version when
 *                           this returns null.
 */

/** Statuses that take an estimate out of circulation entirely. */
export const DEAD_ESTIMATE_STATUSES = ["rejected", "superseded"] as const;

/** Statuses that may still be edited in place. */
export const WRITABLE_ESTIMATE_STATUSES = ["draft", "approved"] as const;

/**
 * Minimal shape we need from a Supabase client. Kept structural so this works
 * with both the cookie-scoped server client and the service-role admin client
 * without dragging generated DB types through every caller.
 */
interface EstimateQueryClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
}

/**
 * The project's current estimate — newest version that has not been rejected
 * or superseded, regardless of whether it is draft, approved, sent, review or
 * accepted.
 *
 * `columns` defaults to "id"; pass more when you need them so callers don't
 * have to round-trip a second query.
 */
export async function getCurrentEstimate<T = { id: string }>(
  supabase: EstimateQueryClient,
  projectId: string,
  columns = "id"
): Promise<T | null> {
  const { data } = await supabase
    .from("estimates")
    .select(columns)
    .eq("project_id", projectId)
    .not("status", "in", `(${DEAD_ESTIMATE_STATUSES.join(",")})`)
    // version is the ordering that matters; created_at only breaks ties, and
    // it must be a tiebreak rather than the sort key (field-capture used it as
    // the sort key and could return v1 for a project whose v2 was backdated).
    .order("version", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  return ((data as T[] | null)?.[0] ?? null);
}

/** Convenience wrapper — just the id. */
export async function getCurrentEstimateId(
  supabase: EstimateQueryClient,
  projectId: string
): Promise<string | null> {
  const est = await getCurrentEstimate<{ id: string }>(supabase, projectId);
  return est?.id ?? null;
}

/**
 * The newest estimate this project may still have line items written into.
 * Returns null when every version is sent/accepted/review — the caller should
 * then create a new draft version rather than mutating a delivered document.
 */
export async function getWritableEstimate<T = { id: string }>(
  supabase: EstimateQueryClient,
  projectId: string,
  columns = "id"
): Promise<T | null> {
  const { data } = await supabase
    .from("estimates")
    .select(columns)
    .eq("project_id", projectId)
    .in("status", WRITABLE_ESTIMATE_STATUSES as unknown as string[])
    .order("version", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  return ((data as T[] | null)?.[0] ?? null);
}

/** Convenience wrapper — just the id. */
export async function getWritableEstimateId(
  supabase: EstimateQueryClient,
  projectId: string
): Promise<string | null> {
  const est = await getWritableEstimate<{ id: string }>(supabase, projectId);
  return est?.id ?? null;
}
