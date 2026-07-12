/**
 * Who may DELETE feed items (company posts, daily logs, punch lists).
 *
 * Deliberately an explicit allowlist, NOT a role check: the `owner` role also
 * covers Nicole and Shannon, but delete is meant for Jorge (his two accounts)
 * and Ryan only. Add an email here to grant delete.
 */
export const FEED_MANAGER_EMAILS: readonly string[] = [
  "jbetancur@penneyconstructioninc.com",
  "jorgebetancurfx@gmail.com",
  "rpenney@penneyconstructioninc.com",
];

export function canManageFeed(email: string | null | undefined): boolean {
  if (!email) return false;
  return FEED_MANAGER_EMAILS.includes(email.trim().toLowerCase());
}
