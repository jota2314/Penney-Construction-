import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { syncGmailForUser } from "@/lib/email/gmail-sync";

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

      results.push({ user: profile.email, ...result });
    } catch (err) {
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
