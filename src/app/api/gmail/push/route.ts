import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessTokenFromRefreshToken } from "@/lib/google/server-auth";
import { syncAndNotifyUser } from "@/lib/email/sync-and-notify";
import { runAutoTriage } from "@/lib/email/auto-triage";

export const maxDuration = 60;

/**
 * Gmail → Cloud Pub/Sub → here. The event-driven half of the inbox daemon:
 * Google publishes a tiny notification whenever the watched mailbox changes,
 * Pub/Sub pushes it to this endpoint, and we run the same per-user sync +
 * auto-triage the cron runs — but instantly, instead of waiting up to 15 min.
 *
 * Security:
 *  - The endpoint is gated by a secret token in the query string
 *    (?token=GMAIL_PUSH_TOKEN). Pub/Sub is configured with that URL, so a
 *    caller without the token is rejected.
 *  - The Pub/Sub payload only carries { emailAddress, historyId }. We never
 *    execute anything from email content; the sync pipeline only files
 *    attachments. Email bodies remain untrusted data.
 *
 * Throttle safety (hard rule — Gmail 429s lock the account for hours):
 *  - Skip users inside a gmail_backoff_until window.
 *  - Debounce on gmail_last_push_sync_at so a burst of push events can't
 *    hammer the Gmail API. The 15-min cron is the backstop.
 *
 * Always ack (2xx) for handled conditions so Pub/Sub doesn't retry-storm.
 */

const DEBOUNCE_MS = 15_000;

export async function POST(request: Request) {
  // 1. Auth: secret token in the push URL.
  const token = new URL(request.url).searchParams.get("token");
  if (!process.env.GMAIL_PUSH_TOKEN || token !== process.env.GMAIL_PUSH_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse the Pub/Sub envelope → { emailAddress, historyId }.
  let emailAddress: string | null = null;
  try {
    const envelope = await request.json();
    const dataB64: string | undefined = envelope?.message?.data;
    if (dataB64) {
      const decoded = JSON.parse(Buffer.from(dataB64, "base64").toString("utf8"));
      emailAddress = typeof decoded?.emailAddress === "string" ? decoded.emailAddress : null;
    }
  } catch (err) {
    // Malformed body — ack so Pub/Sub stops retrying a payload we can't use.
    console.warn("[gmail-push] unparseable envelope:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: true, skipped: "unparseable" });
  }

  if (!emailAddress) {
    return NextResponse.json({ ok: true, skipped: "no emailAddress" });
  }

  const supabase = createAdminClient();

  // 3. Resolve the profile for this mailbox.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, google_refresh_token, gmail_backoff_until, gmail_last_push_sync_at")
    .eq("email", emailAddress)
    .not("google_refresh_token", "is", null)
    .maybeSingle();

  if (!profile || !profile.google_refresh_token) {
    return NextResponse.json({ ok: true, skipped: "no matching user" });
  }

  // 4. Respect an active Gmail backoff window.
  const now = Date.now();
  if (profile.gmail_backoff_until && new Date(profile.gmail_backoff_until).getTime() > now) {
    return NextResponse.json({ ok: true, skipped: "backoff" });
  }

  // 5. Debounce bursts. Claim the window before syncing so overlapping
  //    deliveries collapse into one Gmail call.
  if (
    profile.gmail_last_push_sync_at &&
    now - new Date(profile.gmail_last_push_sync_at).getTime() < DEBOUNCE_MS
  ) {
    return NextResponse.json({ ok: true, skipped: "debounced" });
  }
  await supabase
    .from("profiles")
    .update({ gmail_last_push_sync_at: new Date(now).toISOString() })
    .eq("id", profile.id);

  // 6. Sync + notify + triage (same path as the cron, for one user).
  try {
    const accessToken = await getAccessTokenFromRefreshToken(profile.google_refresh_token);
    if (!accessToken) {
      return NextResponse.json({ ok: true, skipped: "token refresh failed" });
    }

    const result = await syncAndNotifyUser({
      supabase,
      accessToken,
      profile: { id: profile.id, email: profile.email },
      limit: 15,
    });

    let triage = null;
    if (result.stored > 0) {
      try {
        triage = await runAutoTriage(supabase, { limit: 20 });
      } catch (err) {
        console.error("[gmail-push] auto-triage failed:", err instanceof Error ? err.message : String(err));
      }
    }

    return NextResponse.json({ ok: true, stored: result.stored, scanned: result.scanned, triage });
  } catch (err) {
    console.error("[gmail-push] sync failed:", err instanceof Error ? err.message : String(err));
    // Ack anyway — the cron will catch anything we missed, and we don't want
    // Pub/Sub hammering Gmail through us during an outage.
    return NextResponse.json({ ok: true, error: "sync failed" });
  }
}
