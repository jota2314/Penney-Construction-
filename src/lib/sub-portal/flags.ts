/**
 * The sub portal's two rollout switches, ON unless explicitly turned off
 * (NEXT_PUBLIC_SUB_BILLS / NEXT_PUBLIC_SUB_AGREEMENTS set to "0", "false" or
 * "off"). Bills must default on: the old portal invoice upload now answers
 * 410, so "Send an invoice" is the only way in. Agreements show nothing until
 * Ryan sends one. Read them only through these helpers. Client-safe.
 */

/** Unset, empty or anything else counts as on; only "0" / "false" / "off" turn it off. */
export function subPortalFlagOn(value: string | null | undefined): boolean {
  return !/^(0|false|off)$/i.test((value ?? "").trim());
}

/** "Send an invoice" and the sent-back Needed rows (W7). */
export function subBillsEnabled(): boolean {
  return subPortalFlagOn(process.env.NEXT_PUBLIC_SUB_BILLS);
}

/** Agreement rows, signing and the sign Needed rows (W9). */
export function subAgreementsEnabled(): boolean {
  return subPortalFlagOn(process.env.NEXT_PUBLIC_SUB_AGREEMENTS);
}
