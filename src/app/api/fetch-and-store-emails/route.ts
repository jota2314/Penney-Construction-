import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGoogleTokens } from "@/lib/google/auth";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { syncGmailForUser } from "@/lib/email/gmail-sync";
import {
  GmailRateLimitError,
  assertGmailNotThrottled,
  recordGmailThrottle,
} from "@/lib/google/throttle";
import { z } from "zod";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Refuse to call Gmail at all if a throttle window is active. Each
  // call would extend Google's retry-after timestamp.
  try {
    await assertGmailNotThrottled(supabase, user.id);
  } catch (err) {
    if (err instanceof GmailRateLimitError) {
      return NextResponse.json(
        { error: err.message, retry_at: err.retryAt.toISOString() },
        { status: 429 }
      );
    }
    throw err;
  }

  try {
    const parsed = z.object({
      limit: z.number().int().min(1).max(100).default(20),
    }).safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "limit must be between 1 and 100" }, { status: 400 });
    }
    const { limit } = parsed.data;

    // Prefer a freshly-minted access token from the refresh token in
    // the profile — same pattern the cron uses, immune to stale
    // cookies. Fall back to the cookie-based token if no refresh token
    // is on file yet (e.g. immediately after the OAuth callback before
    // the profile row is updated).
    let accessToken: string | null = null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("google_refresh_token")
      .eq("id", user.id)
      .single();

    if (profile?.google_refresh_token) {
      accessToken = await getAccessTokenFromRefreshToken(profile.google_refresh_token);
    }

    if (!accessToken) {
      const tokens = await getGoogleTokens();
      accessToken = tokens?.access_token ?? null;
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: "No Google OAuth tokens. Sign out and sign back in to grant Gmail access." },
        { status: 401 }
      );
    }

    const result = await syncGmailForUser({
      supabase,
      accessToken,
      userId: user.id,
      limit,
    });

    const skipped = result.scanned - result.stored;
    return NextResponse.json({
      stored: result.stored,
      skipped,
      errors: result.errors.length > 0 ? result.errors : undefined,
      message:
        result.errors.length > 0 && result.stored === 0
          ? `Gmail sync failed for ${result.errors.length} email${result.errors.length === 1 ? "" : "s"}`
          : result.stored === 0
          ? `Scanned ${result.scanned} emails — all already stored`
          : `Stored ${result.stored} new emails (scanned ${result.scanned}, skipped ${skipped} duplicates)${result.errors.length > 0 ? `, ${result.errors.length} errors` : ""}`,
    });
  } catch (err) {
    if (err instanceof GmailRateLimitError) {
      // Persist Google's retry-after so subsequent Sync taps short-circuit
      // before hitting Gmail (each call would extend the throttle window).
      try { await recordGmailThrottle(supabase, user.id, err.retryAfterMs); } catch { /* best-effort */ }
      return NextResponse.json(
        { error: err.message, retry_at: err.retryAt.toISOString() },
        { status: 429 }
      );
    }
    // Surface the real error in Vercel runtime logs — without this,
    // the dashboard only sees "500" with no context.
    console.error("[fetch-and-store-emails] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const parsed = z.object({
    emailId: z.string().uuid(),
    is_dismissed: z.boolean(),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid emailId and is_dismissed required" }, { status: 400 });
  }
  const { emailId, is_dismissed } = parsed.data;

  const { error } = await supabase
    .from("inbox_emails")
    .update({ is_dismissed })
    .eq("id", emailId)
    .eq("created_by", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
