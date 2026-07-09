import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push/send";

/**
 * POST /api/email-drafts/[id]/notify
 *
 * Fires a push notification telling a human a parked email draft is waiting for
 * their approval, deep-linking to the /email-draft/[id] review page. Called by
 * the Penney MCP right after it parks a draft (send_email from a signed-in user
 * never sends — it hands off to this review flow).
 *
 * Guarded by the shared service key in app_settings('proposal_pdf_service_key'),
 * the same key the MCP already uses for headless calls. Best-effort: it returns
 * 200 even when the user has no push subscription — the review link in chat is
 * the real deliverable; the push is a convenience.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const admin = createAdminClient();

  // Verify the service key (timing-safe), same pattern as generate-proposal-pdf.
  const serviceKey = request.headers.get("x-service-key");
  const { data: keyRow } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "proposal_pdf_service_key")
    .maybeSingle();
  const expected = String(keyRow?.value ?? "");
  const a = Buffer.from(serviceKey ?? "");
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Invalid service key" }, { status: 401 });
  }

  // Load the draft and resolve who to notify (its creator).
  const { data: draft } = await admin
    .from("email_drafts")
    .select("id, subject, created_by, status")
    .eq("id", id)
    .maybeSingle();
  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", draft.created_by ?? "")
    .maybeSingle();

  if (!profile?.id) {
    // No matching human (e.g. created_by = "mcp") — nothing to notify. Not an error.
    return NextResponse.json({ ok: true, delivered: 0, reason: "no profile for creator" });
  }

  const delivered = await sendPushToUser(admin, profile.id, {
    title: "Draft ready to send",
    body: draft.subject || "Tap to review and send",
    url: `/email-draft/${draft.id}`,
    tag: "email-draft",
  });

  return NextResponse.json({ ok: true, delivered });
}
