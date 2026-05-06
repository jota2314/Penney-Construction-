/**
 * Gmail OAuth health check — creates a Gmail DRAFT (never sends).
 *
 * Use this to verify the full OAuth + Gmail API pipeline works without
 * burning send quota or risking a rate-limit throttle. Drafts have a
 * separate, much higher quota and don't trigger anti-abuse classifiers.
 *
 * Returns:
 *  - 200 + { ok: true, draftId, profile } when the pipeline works
 *  - 200 + { ok: false, status, reason, body } when Gmail rejects the call
 *    so the caller can see exactly which throttle/error is active
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleFetch } from "@/lib/google/auth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const { to } = (await request.json().catch(() => ({}))) as { to?: string };
  const recipient = to || user.email || "test@example.com";

  // Build a minimal RFC 2822 message — no signature, no HTML — so the
  // result reflects the raw Gmail API path, not our signature template.
  const message = [
    `To: ${recipient}`,
    `Subject: Penney health check ${new Date().toISOString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    `This is an automated Gmail OAuth health check from the Penney app. It`,
    `was created as a DRAFT and never sent. You can delete it.`,
  ].join("\r\n");

  const raw = btoa(unescape(encodeURIComponent(message)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const profileRes = await googleFetch(`${GMAIL_API}/users/me/profile`, { method: "GET" });
  const profile = profileRes.ok ? await profileRes.json() : null;

  const draftRes = await googleFetch(`${GMAIL_API}/users/me/drafts`, {
    method: "POST",
    body: JSON.stringify({ message: { raw } }),
  });

  if (!draftRes.ok) {
    const body = await draftRes.text();
    let reason: string | null = null;
    try {
      const parsed = JSON.parse(body);
      reason = parsed?.error?.errors?.[0]?.reason || parsed?.error?.status || null;
    } catch { /* non-JSON */ }
    console.error(`[gmail-health] HTTP ${draftRes.status} reason=${reason} body=${body}`);
    return NextResponse.json({
      ok: false,
      status: draftRes.status,
      reason,
      retryAfter: draftRes.headers.get("retry-after"),
      body,
      profile,
    });
  }

  const draft = await draftRes.json();
  return NextResponse.json({ ok: true, draftId: draft.id, profile });
}
