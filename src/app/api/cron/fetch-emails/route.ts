import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { GmailRateLimitError, recordGmailThrottle } from "@/lib/google/throttle";
import { syncAndNotifyUser } from "@/lib/email/sync-and-notify";
import { classifyPendingInbound } from "@/lib/email/classify";
import { runEstimatingIntake } from "@/lib/email/estimating-intake";

export const maxDuration = 60;

// Leave headroom under maxDuration: stop starting new work at 45s so the
// response returns cleanly instead of the runtime killing us mid-user with a
// 504 (which is what every run was doing on 8/25 — partial work, no report).
const TIME_BUDGET_MS = 45_000;
// Catch-up classification needs a real slice of time; skip it when the sync
// ate the tick. It stops early enough to leave estimating intake its window.
const CATCH_UP_MIN_MS = 8_000;
const ESTIMATING_RESERVE_MS = 8_000;

export async function GET(request: Request) {
  const startedAt = Date.now();
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - startedAt);

  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Skip users in a Gmail backoff or throttle window. Hitting Gmail again
  // before that timestamp expires extends the penalty — exactly what we
  // don't want.
  const nowIso = new Date().toISOString();
  const { data: allProfiles } = await supabase
    .from("profiles")
    .select("id, email, google_refresh_token, gmail_backoff_until, gmail_throttled_until")
    .not("google_refresh_token", "is", null)
    .or(`gmail_backoff_until.is.null,gmail_backoff_until.lte.${nowIso}`);
  // recordGmailThrottle (below, on a 429) writes gmail_throttled_until, not
  // gmail_backoff_until. Without this check the cron called Gmail again every
  // tick of an active throttle, which re-arms Google's retry-after.
  const profiles = (allProfiles ?? []).filter(
    (p) => !p.gmail_throttled_until || new Date(p.gmail_throttled_until).getTime() <= Date.now()
  );

  if (profiles.length === 0) {
    return NextResponse.json({ message: "No users with refresh tokens", users: 0 });
  }

  const results: Array<{ user: string; stored: number; scanned: number; errors: string[] }> = [];

  // Rotate who goes first each tick so that, when the budget runs out
  // mid-list, it isn't always the same trailing users who never sync.
  const offset = Math.floor(Date.now() / (15 * 60 * 1000)) % profiles.length;
  const rotated = [...profiles.slice(offset), ...profiles.slice(0, offset)];

  for (const profile of rotated) {
    if (!profile.google_refresh_token) continue;

    if (timeLeft() <= 0) {
      results.push({ user: profile.email, stored: 0, scanned: 0, errors: ["deferred: out of time budget"] });
      continue;
    }

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
        // Checked between users only, one mailbox's 10-message loop
        // (attachments, Drive, classification) could still run the function
        // into the 60 s kill. The loop itself now stops starting new work at
        // the budget.
        deadlineMs: startedAt + TIME_BUDGET_MS,
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

  // The old auto-triage step ran here: it handed bills to the Bookkeeper agent
  // (deleted 9/10) and read PDFs with an unbounded Haiku call — the step that
  // pushed ticks past 60 s. Its project link now happens in
  // persistClassification. What's left is catching up inbound mail that sync
  // stored but didn't get to classify.
  let classified = null;
  const catchUpDeadline = startedAt + TIME_BUDGET_MS - ESTIMATING_RESERVE_MS;
  if (catchUpDeadline - Date.now() >= CATCH_UP_MIN_MS) {
    try {
      classified = await classifyPendingInbound(supabase, { deadlineMs: catchUpDeadline });
    } catch (err) {
      console.error("[cron] catch-up classification failed:", err instanceof Error ? err.message : String(err));
    }
  }

  let estimating = null;
  if (timeLeft() > 3000) {
    try { estimating = await runEstimatingIntake(supabase, Date.now() + Math.min(timeLeft() - 1000, 8000)); }
    catch (error) { estimating = { error: error instanceof Error ? error.message : String(error) }; }
  }
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    totalStored,
    results,
    classified,
    estimating,
  });
}
