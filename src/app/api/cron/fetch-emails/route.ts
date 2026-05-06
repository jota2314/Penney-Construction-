import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { syncGmailForUser } from "@/lib/email/gmail-sync";
import { GmailRateLimitError, recordGmailThrottle } from "@/lib/google/throttle";
import { sendPushToUser } from "@/lib/push/send";

export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, google_refresh_token")
    .not("google_refresh_token", "is", null);

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

      const result = await syncGmailForUser({
        supabase,
        accessToken,
        userId: profile.id,
        limit: 10,
      });

      // Notify on newly stored inbound emails (not seen by user yet).
      if (result.stored > 0) {
        const { data: fresh } = await supabase
          .from("inbox_emails")
          .select("id, from_name, from_email, subject, snippet")
          .eq("created_by", profile.id)
          .eq("direction", "inbound")
          .is("notified_at", null)
          .order("date", { ascending: false })
          .limit(5);

        if (fresh && fresh.length > 0) {
          if (fresh.length === 1) {
            const e = fresh[0];
            await sendPushToUser(supabase, profile.id, {
              title: e.from_name || e.from_email || "New email",
              body: `${e.subject || "(no subject)"}\n${(e.snippet || "").slice(0, 120)}`,
              url: `/command-center/email/${e.id}`,
              tag: `email-${e.id}`,
            });
          } else {
            await sendPushToUser(supabase, profile.id, {
              title: `${fresh.length} new emails`,
              body: fresh
                .slice(0, 3)
                .map((e) => e.from_name || e.from_email || "Unknown")
                .join(", "),
              url: `/command-center/emails`,
              tag: "email-batch",
            });
          }

          await supabase
            .from("inbox_emails")
            .update({ notified_at: new Date().toISOString() })
            .in("id", fresh.map((e) => e.id));
        }
      }

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
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    totalStored,
    results,
  });
}
