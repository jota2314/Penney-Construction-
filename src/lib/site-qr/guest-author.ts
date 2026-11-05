/** Display supplied job-site details without changing the post's guest identity. */
export function siteGuestAuthorName(
  isGuest: boolean | null | undefined,
  name?: string | null,
  trade?: string | null,
  company?: string | null,
): string | null {
  if (!isGuest) return null;
  const details = [name, trade, company].map((value) => value?.trim()).filter(Boolean);
  return details.length ? details.join(" · ") : "Job-site update";
}
