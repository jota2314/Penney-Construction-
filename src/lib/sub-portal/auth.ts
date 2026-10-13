import { createHash } from "crypto";
import type { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Cookie set on successful phone+PIN login at /sub. */
export const SUB_PORTAL_COOKIE = "sub_portal_token";
export const SUB_PORTAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 60; // 60 days

/** Sign the sub in on this response — PIN login and job-QR sign-up both land here. */
export function setSubPortalCookie(res: NextResponse, token: string) {
  res.cookies.set(SUB_PORTAL_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SUB_PORTAL_COOKIE_MAX_AGE,
  });
}

/** "9784300049" → "978-430-0049", the way phones read in the sub directory. */
export function formatPhone(digits: string): string {
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}

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
