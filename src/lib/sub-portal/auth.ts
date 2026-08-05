import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

/** Cookie set on successful phone+PIN login at /sub. */
export const SUB_PORTAL_COOKIE = "sub_portal_token";
export const SUB_PORTAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 60; // 60 days

/** Digits only, leading country code 1 stripped: "(978) 430-0049" → "9784300049". */
export function normalizePhone(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/** The stored PIN is sha256("{token}:{pin}") — the row's token is the salt. */
export function hashPin(token: string, pin: string): string {
  return createHash("sha256").update(`${token}:${pin}`).digest("hex");
}

/**
 * Service role for public, token-gated access — same pattern as /api/portal.
 * The public /sub pages NEVER use the anon key; everything routes through the
 * sub-portal API and is validated server-side, so RLS stays intact.
 */
export function getSubPortalClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
