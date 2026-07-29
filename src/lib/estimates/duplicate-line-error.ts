/**
 * Friendly wording for the duplicate-line guard.
 *
 * Migration 00108 adds a partial unique index,
 * `estimate_line_items_no_duplicate_description`, over
 * (estimate_id, lower(trim(description)), coalesce(section,'')) for non-header
 * rows. It exists because ~12 code paths insert line items and guarding each
 * one in application code is exactly how the Jackling (PC-2026-099)
 * double-entry survived: the takeoff chat re-added all 7 trades that already
 * existed, $26,279.01 of double-counted scope.
 *
 * The raw failure is a Postgres 23505 whose message names the index, which
 * means nothing to Jorge mid-estimate. Anything that inserts a line item runs
 * its error through here first.
 */

const DUPLICATE_INDEX = "estimate_line_items_no_duplicate_description";

interface MaybePostgrestError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

/** True when this error is the duplicate-line guard firing. */
export function isDuplicateLineError(error: MaybePostgrestError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "23505") {
    // 23505 is any unique violation on the table; only claim the ones that
    // are actually ours, so a genuine PK collision still reads as a bug.
    return `${error.message ?? ""} ${error.details ?? ""}`.includes(DUPLICATE_INDEX);
  }
  return false;
}

/**
 * The message to show the user. Says what was rejected and what to do about
 * it, because the guard cannot tell a double-entry from deliberately repeated
 * scope — only the estimator can.
 */
export function duplicateLineMessage(description?: string | null, section?: string | null): string {
  const what = description?.trim() ? `"${description.trim()}"` : "That line";
  const where = section?.trim() ? `the "${section.trim()}" section` : "this estimate";
  return (
    `${what} is already in ${where}, so it was not added again — two identical ` +
    `lines double-count the money. Update the existing line instead. If this is ` +
    `genuinely separate scope, give it its own description (e.g. "… — Front" vs ` +
    `"… — Rear") or put it in a different section.`
  );
}

/**
 * Convenience: map a Supabase insert error to a user-facing string, or null
 * when the error is not the duplicate guard (caller keeps its own handling).
 */
export function describeDuplicateLineError(
  error: MaybePostgrestError | null | undefined,
  description?: string | null,
  section?: string | null
): string | null {
  return isDuplicateLineError(error) ? duplicateLineMessage(description, section) : null;
}
