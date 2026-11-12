/**
 * What kind of line a schedule step is, by its name. Shared by the server
 * (what counts as a job's "now" and "next") and the board's job cards (what
 * is worth a bar in the two-week strip).
 */

/** Runs alongside the whole job: never the answer to "what's on today". */
const OVERHEAD =
  /dumpster|porta|portable (toilet|restroom)|(site|floor|dust) protection|^protection\b|dust control|general conditions|supervision|daily cleanup|debris|parking rules/i;

/** A date to hit, not work on site. */
const ADMIN = /^(order|selection due|payment|delivery|milestone)\b/i;

export function isOverheadStep(name: string | null | undefined): boolean {
  return OVERHEAD.test(name ?? "");
}

export function isAdminStep(name: string | null | undefined): boolean {
  return ADMIN.test(name ?? "");
}

/** Trade work or an inspection: what a person means by "what's happening on the job". */
export function isSiteWork(name: string | null | undefined): boolean {
  return !isOverheadStep(name) && !isAdminStep(name);
}
