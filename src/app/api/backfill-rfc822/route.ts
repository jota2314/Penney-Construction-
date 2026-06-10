/**
 * One-off backfill: populate inbox_emails.rfc822_message_id on rows synced
 * before the header was captured (migration 00082 added the column; the
 * sync only started writing it in June 2026). Without it, replies sent via
 * the MCP send_email in_reply_to path can't thread into the original Gmail
 * conversation.
 *
 * Uses messages.get format=metadata (headers only, no body/attachments) so
 * it's cheap against Gmail quota. Protected by CRON_SECRET like the cron
 * routes. Re-runnable: only touches rows where rfc822_message_id IS NULL,
 * newest first. ?limit=N caps rows per user per run (default 100).
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessTokenFromRefreshToken, googleFetchWithToken } from "@/lib/google/server-auth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(
    Math.max(Number(new URL(request.url).searchParams.get("limit")) || 100, 1),
    500
  );

  const supabase = createAdminClient();

  // Same backoff guard as the fetch-emails cron — never poke Gmail for a
  // user inside a 429 penalty window.
  const nowIso = new Date().toISOString();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, google_refresh_token")
    .not("google_refresh_token", "is", null)
    .or(`gmail_backoff_until.is.null,gmail_backoff_until.lte.${nowIso}`);

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ message: "No users with refresh tokens", users: 0 });
  }

  const results: Array<{
    user: string;
    updated: number;
    duplicates: number;
    missing: number;
    errors: string[];
  }> = [];

  for (const profile of profiles) {
    if (!profile.google_refresh_token) continue;
    const r = { user: profile.email, updated: 0, duplicates: 0, missing: 0, errors: [] as string[] };
    results.push(r);

    const accessToken = await getAccessTokenFromRefreshToken(profile.google_refresh_token);
    if (!accessToken) {
      r.errors.push("Failed to refresh access token");
      continue;
    }

    const { data: rows } = await supabase
      .from("inbox_emails")
      .select("id, gmail_message_id")
      .eq("created_by", profile.id)
      .is("rfc822_message_id", null)
      .order("date", { ascending: false })
      .limit(limit);

    for (const row of rows ?? []) {
      try {
        const res = await googleFetchWithToken(
          `${GMAIL_API}/users/me/messages/${row.gmail_message_id}?format=metadata&metadataHeaders=Message-ID`,
          accessToken
        );
        if (res.status === 429) {
          r.errors.push("Gmail 429 — stopping this user");
          break;
        }
        if (!res.ok) {
          // 404 = message deleted from Gmail since sync; nothing to thread to.
          r.missing++;
          continue;
        }
        const msg = await res.json();
        const headers: { name: string; value: string }[] = msg.payload?.headers || [];
        const messageId = headers
          .find((h) => h.name.toLowerCase() === "message-id")
          ?.value?.trim();
        if (!messageId) {
          r.missing++;
          continue;
        }

        const { error } = await supabase
          .from("inbox_emails")
          .update({ rfc822_message_id: messageId })
          .eq("id", row.id);
        if (error) {
          // 23505: this row is a pre-index cross-account duplicate of a row
          // that already carries the id. Leave it NULL — deleting is not
          // this route's call (the row may hold triage state / project links).
          if (error.code === "23505") r.duplicates++;
          else r.errors.push(`${row.gmail_message_id}: ${error.message}`);
          continue;
        }
        r.updated++;
      } catch (err) {
        r.errors.push(
          `${row.gmail_message_id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  return NextResponse.json({ timestamp: new Date().toISOString(), limit, results });
}
