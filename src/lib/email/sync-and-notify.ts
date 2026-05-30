/**
 * Per-user "sync Gmail + push-notify newly stored inbound mail" happy path.
 *
 * Extracted from the fetch-emails cron so the event-driven Gmail push webhook
 * (/api/gmail/push) reuses the exact same logic. The cron loops this over every
 * profile; the webhook runs it for the single profile that fired the push.
 *
 * Throttle note: this only calls Gmail via syncGmailForUser, which already
 * handles 429 by writing gmail_backoff_until and bailing. Callers are
 * responsible for skipping users that are inside a backoff window.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { syncGmailForUser, type SyncResult } from "./gmail-sync";
import { sendPushToUser } from "@/lib/push/send";

export async function syncAndNotifyUser(opts: {
  supabase: SupabaseClient;
  accessToken: string;
  profile: { id: string; email: string };
  limit?: number;
}): Promise<SyncResult> {
  const { supabase, accessToken, profile, limit = 10 } = opts;

  const result = await syncGmailForUser({
    supabase,
    accessToken,
    userId: profile.id,
    limit,
  });

  // Notify on unseen inbound mail. This runs every call regardless of
  // whether THIS sync stored anything: the app's Fetch path and the
  // Gmail push webhook also store emails (without notifying), so gating
  // on result.stored > 0 meant any message stored by another path before
  // this tick was never pushed — notifications silently stopped.
  //
  // Only push recent mail; older unnotified inbound is stamped silently
  // below so a backlog can't spam stale notifications or grow unbounded.
  const recentCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: fresh } = await supabase
    .from("inbox_emails")
    .select("id, from_name, from_email, subject, snippet")
    .eq("created_by", profile.id)
    .eq("direction", "inbound")
    .is("notified_at", null)
    .gte("date", recentCutoff)
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
      .in(
        "id",
        fresh.map((e) => e.id),
      );
  }

  // Clear older unnotified inbound (pre-existing backlog, or mail stored
  // outside the recent window) without pushing, so it neither spams the
  // user nor gets re-scanned on every tick.
  await supabase
    .from("inbox_emails")
    .update({ notified_at: new Date().toISOString() })
    .eq("created_by", profile.id)
    .eq("direction", "inbound")
    .is("notified_at", null)
    .lt("date", recentCutoff);

  return result;
}
