/** A typed name on a no-login upload is not a verified staff/sub identity. */
export function siteGuestAuthorName(isGuest: boolean | null | undefined, name?: string | null): string | null {
  if (!isGuest) return null;
  const supplied = name?.trim();
  return supplied ? `${supplied} · Job-site guest` : "Job-site guest";
}
