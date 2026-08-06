import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * WHOOP OAuth helpers. Mirrors the Google token pattern:
 * access token in an httpOnly cookie, refresh token in cookie + profiles row.
 *
 * WHOOP rotates refresh tokens — every refresh returns a NEW refresh_token
 * and invalidates the old one, so the new one must always be persisted.
 */

export const WHOOP_API_BASE = "https://api.prod.whoop.com/developer";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

export const WHOOP_ACCESS_COOKIE = "whoop-access-token";
export const WHOOP_REFRESH_COOKIE = "whoop-refresh-token";

export interface WhoopTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export function getWhoopClientCreds() {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export async function exchangeWhoopCode(
  code: string,
  redirectUri: string
): Promise<WhoopTokens | null> {
  const creds = getWhoopClientCreds();
  if (!creds) return null;

  const res = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  const tokens = await res.json().catch(() => null);
  if (!tokens?.access_token) return null;
  return tokens as WhoopTokens;
}

export async function refreshWhoopTokens(
  refreshToken: string
): Promise<WhoopTokens | null> {
  const creds = getWhoopClientCreds();
  if (!creds) return null;

  const res = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: "offline",
    }),
  });

  const tokens = await res.json().catch(() => null);
  if (!tokens?.access_token) return null;
  return tokens as WhoopTokens;
}

/** Persist tokens to cookies (+ refresh token to the user's profile row). */
export async function saveWhoopTokens(tokens: WhoopTokens) {
  const cookieStore = await cookies();

  cookieStore.set(WHOOP_ACCESS_COOKIE, tokens.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: tokens.expires_in || 3600,
  });

  if (tokens.refresh_token) {
    cookieStore.set(WHOOP_REFRESH_COOKIE, tokens.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("profiles")
        .update({ whoop_refresh_token: tokens.refresh_token })
        .eq("id", user.id);
    }
  }
}

/** Refresh token from cookie first, DB fallback (survives cleared cookies). */
export async function getStoredWhoopRefreshToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(WHOOP_REFRESH_COOKIE)?.value;
  if (fromCookie) return fromCookie;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("whoop_refresh_token")
    .eq("id", user.id)
    .single();

  return profile?.whoop_refresh_token || null;
}
