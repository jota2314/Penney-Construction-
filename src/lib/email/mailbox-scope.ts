/**
 * Which inbox_emails rows belong in a given person's inbox.
 *
 * One email that reaches several team mailboxes is stored ONCE (rfc822
 * dedup, migration 00082) under whichever profile's Gmail synced first.
 * `mailbox_ids` (migration 00136) lists every profile whose Gmail actually
 * contains the message, so an inbox is "rows I own OR rows stamped with
 * me" — never just `created_by`, which hid a third of Nicole's mail.
 */

/** PostgREST `.or()` expression: rows visible in this profile's inbox. */
export function mailboxFilter(profileId: string): string {
  return `created_by.eq.${profileId},mailbox_ids.cs.{${profileId}}`;
}

/** True when the row belongs in this profile's inbox. */
export function isInMailbox(
  email: { created_by?: string | null; mailbox_ids?: string[] | null },
  profileId: string,
): boolean {
  return email.created_by === profileId || (email.mailbox_ids ?? []).includes(profileId);
}

/**
 * `direction` is stored from the FIRST syncer's point of view (Gmail's SENT
 * label in their account). A message Jorge sent to Nicole is "outbound" on
 * the row, but in Nicole's inbox it is incoming mail. Re-derive per viewer.
 */
export function viewerDirection(
  email: { created_by?: string | null; direction: string; from_email?: string | null },
  viewerId: string,
  viewerEmail: string | null | undefined,
): string {
  if (!email.created_by || email.created_by === viewerId) return email.direction;
  const from = (email.from_email ?? "").toLowerCase();
  const me = (viewerEmail ?? "").toLowerCase();
  return me && from.includes(me) ? "outbound" : "inbound";
}
