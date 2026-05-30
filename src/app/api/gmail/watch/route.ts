import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessTokenFromRefreshToken, googleFetchWithToken } from "@/lib/google/server-auth";

export const maxDuration = 60;

/**
 * Arms (and renews) the Gmail push watch for every connected user.
 *
 * gmail.users.watch tells Gmail to publish a notification to our Cloud Pub/Sub
 * topic whenever the user's INBOX changes. The registration expires after 7
 * days, so a daily cron hits this route to renew it before it lapses.
 *
 * Requires:
 *  - GMAIL_PUBSUB_TOPIC = projects/<gcp-project>/topics/<topic>
 *  - The topic must grant Pub/Sub Publisher to gmail-api-push@system.gserviceaccount.com
 *  - CRON_SECRET (this route is bearer-protected like the other crons)
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) {
    return NextResponse.json({ error: "GMAIL_PUBSUB_TOPIC not configured" }, { status: 500 });
  }

  const supabase = createAdminClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, google_refresh_token")
    .not("google_refresh_token", "is", null);

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ message: "No users with refresh tokens", armed: 0 });
  }

  const results: Array<{ user: string; ok: boolean; expiration?: string; error?: string }> = [];

  for (const profile of profiles) {
    if (!profile.google_refresh_token) continue;
    try {
      const accessToken = await getAccessTokenFromRefreshToken(profile.google_refresh_token);
      if (!accessToken) {
        results.push({ user: profile.email, ok: false, error: "token refresh failed" });
        continue;
      }

      const res = await googleFetchWithToken(
        "https://gmail.googleapis.com/gmail/v1/users/me/watch",
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            topicName,
            labelIds: ["INBOX"],
            labelFilterBehavior: "INCLUDE",
          }),
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "<no body>");
        results.push({ user: profile.email, ok: false, error: `HTTP ${res.status} ${body.slice(0, 300)}` });
        continue;
      }

      const data = await res.json();
      // expiration is a string of millis since epoch.
      const expirationIso = data.expiration
        ? new Date(parseInt(data.expiration, 10)).toISOString()
        : null;

      await supabase
        .from("profiles")
        .update({ gmail_watch_expiration: expirationIso })
        .eq("id", profile.id);

      results.push({ user: profile.email, ok: true, expiration: expirationIso ?? undefined });
    } catch (err) {
      results.push({ user: profile.email, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    topic: topicName,
    armed: results.filter((r) => r.ok).length,
    results,
  });
}
