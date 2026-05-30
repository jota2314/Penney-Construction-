import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { GmailRateLimitError, recordGmailThrottle } from "@/lib/google/throttle";
import { syncAndNotifyUser } from "@/lib/email/sync-and-notify";
import { runAutoTriage } from "@/lib/email/auto-triage";

export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Skip users in a Gmail backoff window. When sync hits 429, it
  // sets gmail_backoff_until to (Gmail's retry-after + 5 min).
  // Hitting Gmail again before that timestamp expires extends the
  // penalty — exactly what we don't want.
  const nowIso = new Date().toISOString();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, google_refresh_token, gmail_backoff_until")
    .not("google_refresh_token", "is", null)
    .or(`gmail_backoff_until.is.null,gmail_backoff_until.lte.${nowIso}`);

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ message: "No users with refresh tokens", users: 0 });
  }

  const results: Array<{ user: string; stored: number; scanned: number; errors: string[] }> = [];

  for (const profile of profiles) {
    if (!profile.google_refresh_token) continue;

    try {
      const accessToken = await getAccessTokenFromRefreshToken(profile.google_refresh_token);
      if (!accessToken) {
        results.push({ user: profile.email, stored: 0, scanned: 0, errors: ["Failed to refresh access token"] });
        continue;
      }

      const result = await syncAndNotifyUser({
        supabase,
        accessToken,
        profile: { id: profile.id, email: profile.email },
        limit: 10,
      });

      results.push({ user: profile.email, ...result });
    } catch (err) {
      if (err instanceof GmailRateLimitError) {
        // Persist the throttle for this user so subsequent ticks (and
        // user-driven Sync taps) skip the Gmail call entirely.
        try { await recordGmailThrottle(supabase, profile.id, err.retryAfterMs); } catch { /* best-effort */ }
        results.push({
          user: profile.email,
          stored: 0,
          scanned: 0,
          errors: [`throttled until ${err.retryAt.toISOString()}`],
        });
        continue;
      }
      results.push({
        user: profile.email,
        stored: 0,
        scanned: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  const totalStored = results.reduce((sum, r) => sum + r.stored, 0);

  // After every cron sync, run auto-triage over newly-stored emails.
  // Bounded (limit 20) so a backlog doesn't blow the 60s function budget.
  // Only acts on high-confidence cases (matched project + clear content type);
  // ambiguous emails stay for the manual triage UI.
  let triage = null;
  try {
    triage = await runAutoTriage(supabase, { limit: 20 });
  } catch (err) {
    console.error("[cron] auto-triage failed:", err instanceof Error ? err.message : String(err));
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    totalStored,
    results,
    triage,
  });
}
