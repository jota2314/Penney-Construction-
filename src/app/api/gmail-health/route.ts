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
    ? await probeToken(cookieTokens.access_token, supabase, user.id, throttledForSec > 0)
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
      ? await probeToken(freshAccess, supabase, user.id, throttledForSec > 0)
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

async function probeToken(accessToken: string, supabase?: Awaited<ReturnType<typeof createClient>>, userId?: string, skipGmail?: boolean) {
  // 1. Ask Google what scopes this token actually has — this hits the
  // OAuth tokeninfo endpoint, NOT Gmail. Safe to call even when throttled.
  const infoRes = await fetch(`${TOKENINFO}?access_token=${accessToken}`);
  let tokenInfo: Record<string, unknown> | string;
  try {
    tokenInfo = infoRes.ok ? await infoRes.json() : { error: await infoRes.text() };
  } catch {
    tokenInfo = "<unparseable tokeninfo response>";
  }

  // 2. Hit Gmail's profile endpoint — but ONLY if we're not currently
  // throttled. Calling Gmail while throttled extends Google's retry-after
  // window. When skipGmail=true, return a placeholder instead.
  let profileStatus: number | string = "skipped (throttled — would extend window)";
  let profileBody: unknown = null;
  if (!skipGmail) {
    const profileRes = await fetch(`${GMAIL_API}/users/me/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    profileStatus = profileRes.status;
    try {
      profileBody = profileRes.ok ? await profileRes.json() : await profileRes.text();
    } catch {
      profileBody = "<unparseable profile response>";
    }
    // If Gmail just told us we're rate-limited, persist the retry-after
    // immediately so subsequent calls (sends, syncs, even another health
    // check) short-circuit and don't extend the window further.
    if (profileRes.status === 429 && supabase && userId) {
      const body = typeof profileBody === "string" ? profileBody : JSON.stringify(profileBody);
      const headerVal = profileRes.headers.get("retry-after");
      const waitMs = parseRetryAfterMs(headerVal, body);
      try {
        await supabase
          .from("profiles")
          .update({ gmail_throttled_until: new Date(Date.now() + waitMs).toISOString() })
          .eq("id", userId);
      } catch { /* best-effort */ }
    }
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
    profile_status: profileStatus,
    profile_body: profileBody,
    tokeninfo_status: infoRes.status,
    tokeninfo_body: tokenInfo,
  };
}

function parseRetryAfterMs(headerVal: string | null, body: string): number {
  if (headerVal) {
    const seconds = Number(headerVal);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const asDate = Date.parse(headerVal);
    if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  }
  const match = body.match(/Retry after (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  if (match) {
    const t = Date.parse(match[1]);
    if (!Number.isNaN(t)) return Math.max(0, t - Date.now());
  }
  return 60_000;
}

