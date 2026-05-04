import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGoogleTokens } from "@/lib/google/auth";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { syncGmailForUser } from "@/lib/email/gmail-sync";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { limit = 20 } = await request.json().catch(() => ({}));

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
        result.stored === 0
          ? `Scanned ${result.scanned} emails — all already stored`
          : `Stored ${result.stored} new emails (scanned ${result.scanned}, skipped ${skipped} duplicates)${result.errors.length > 0 ? `, ${result.errors.length} errors` : ""}`,
    });
  } catch (err) {
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

  const { emailId, is_dismissed } = await request.json();
  if (!emailId) return NextResponse.json({ error: "emailId required" }, { status: 400 });

  const { error } = await supabase
    .from("inbox_emails")
    .update({ is_dismissed: !!is_dismissed })
    .eq("id", emailId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
