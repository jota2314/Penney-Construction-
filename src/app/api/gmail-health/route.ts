/**
 * Gmail OAuth health check — diagnoses scope and token state without
 * sending or drafting anything.
 *
 * Compares two token paths the app uses:
 *  - Cookie-based access token (used by user-facing requests)
 *  - Refresh-token-based access token (used by cron / server jobs)
 *
 * For each, calls Google's tokeninfo endpoint to see the *actual* scopes
 * the token holds, and tries gmail.users.profile.get (gmail.readonly) to
 * verify Gmail API access. No send, no draft, zero quota cost.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGoogleTokens } from "@/lib/google/auth";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const TOKENINFO = "https://www.googleapis.com/oauth2/v3/tokeninfo";

const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export const runtime = "nodejs";

export async function GET() {
  return runHealthCheck();
}

export async function POST() {
  return runHealthCheck();
}

async function runHealthCheck() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  // Show the local throttle state so the user can see when it clears
  // without having to hammer Gmail to find out.
  const { data: profileRow0 } = await supabase
    .from("profiles")
    .select("gmail_throttled_until")
    .eq("id", user.id)
    .maybeSingle();
  const throttledUntil = profileRow0?.gmail_throttled_until ?? null;
  const throttledForSec = throttledUntil
    ? Math.max(0, Math.ceil((new Date(throttledUntil).getTime() - Date.now()) / 1000))
    : 0;

  // Path 1 — cookie-based access token (user-facing path, used by sendEmail)
  const cookieTokens = await getGoogleTokens();
  const cookieResult = cookieTokens
    ? await probeToken(cookieTokens.access_token)
    : { error: "No cookie-based access token" };

  // Path 2 — refresh-token-based access token (cron / server-auth path)
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("google_refresh_token")
    .eq("id", user.id)
    .single();

  let refreshResult: unknown = { error: "No refresh token in profiles table" };
  if (profileRow?.google_refresh_token) {
    const freshAccess = await getAccessTokenFromRefreshToken(profileRow.google_refresh_token);
    refreshResult = freshAccess
      ? await probeToken(freshAccess)
      : { error: "Refresh-token exchange failed (refresh token may be revoked or bound to a different OAuth client)" };
  }

  return NextResponse.json({
    user_email: user.email,
    required_scopes: REQUIRED_SCOPES,
    local_throttle: {
      throttled_until: throttledUntil,
      seconds_remaining: throttledForSec,
      active: throttledForSec > 0,
    },
    cookie_token: cookieResult,
    refresh_token: refreshResult,
  });
}

async function probeToken(accessToken: string) {
  // 1. Ask Google what scopes this token actually has
  const infoRes = await fetch(`${TOKENINFO}?access_token=${accessToken}`);
  let tokenInfo: Record<string, unknown> | string;
  try {
    tokenInfo = infoRes.ok ? await infoRes.json() : { error: await infoRes.text() };
  } catch {
    tokenInfo = "<unparseable tokeninfo response>";
  }

  // 2. Hit a real Gmail endpoint that needs gmail.readonly
  const profileRes = await fetch(`${GMAIL_API}/users/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  let profileBody: unknown;
  try {
    profileBody = profileRes.ok ? await profileRes.json() : await profileRes.text();
  } catch {
    profileBody = "<unparseable profile response>";
  }

  // 3. Compute which required scopes are missing
  const grantedScopes =
    typeof tokenInfo === "object" && tokenInfo !== null && typeof tokenInfo.scope === "string"
      ? tokenInfo.scope.split(" ")
      : [];
  const missingScopes = REQUIRED_SCOPES.filter((s) => !grantedScopes.includes(s));

  return {
    granted_scopes: grantedScopes,
    missing_scopes: missingScopes,
    token_audience: typeof tokenInfo === "object" && tokenInfo !== null
      ? typeof tokenInfo.aud === "string"
        ? `${tokenInfo.aud.slice(0, 16)}…`
        : null
      : null,
    expires_in_sec: typeof tokenInfo === "object" && tokenInfo !== null
      ? tokenInfo.expires_in
      : null,
    profile_status: profileRes.status,
    profile_body: profileBody,
    tokeninfo_status: infoRes.status,
    tokeninfo_body: tokenInfo,
  };
}

