import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setSubPortalCookie } from "@/lib/sub-portal/auth";
import { verifySubGoogleIdentity } from "@/lib/sub-portal/google-identity";
import { createSubGoogleSession } from "@/lib/sub-portal/google-session";
import { refuseStaffBrowser } from "@/lib/sub-portal/staff-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NONCE_COOKIE = "sub_google_nonce";
const CANONICAL_ORIGIN = "https://www.penneyconstruction.build";

async function googleClientId() {
  const configured = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (configured) return configured;
  const { data, error } = await createAdminClient().from("app_settings")
    .select("value").eq("key", "google_client_id").maybeSingle();
  if (error || !data?.value) throw new Error("Google sign-in is not configured yet.");
  return String(data.value);
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** The client calls this only from /sub; credentials never create a staff session. */
export async function GET(request: NextRequest) {
  const staff = await refuseStaffBrowser(request);
  if (staff) return staff;
  if (request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Open the Penney sign-in page first." }, 403);
  try {
    const clientId = await googleClientId();
    const nonce = randomBytes(32).toString("base64url");
    const response = json({ clientId, nonce });
    response.cookies.set(NONCE_COOKIE, nonce, {
      httpOnly: true, secure: process.env.NODE_ENV === "production",
      sameSite: "strict", path: "/api/sub-portal/google", maxAge: 600,
    });
    return response;
  } catch {
    return json({ error: "Google sign-in is unavailable. Use your phone and PIN or contact the office." }, 503);
  }
}

export async function POST(request: NextRequest) {
  const origin = process.env.NODE_ENV === "production" ? CANONICAL_ORIGIN : request.nextUrl.origin;
  if (request.headers.get("origin") !== origin) return json({ error: "Open the Penney sign-in page first." }, 403);
  const staff = await refuseStaffBrowser(request);
  if (staff) return staff;
  const nonce = request.cookies.get(NONCE_COOKIE)?.value;
  if (!nonce) return json({ error: "Sign-in expired. Reload this page and try again." }, 401);

  let credential: unknown;
  try {
    ({ credential } = await request.json());
  } catch {
    return json({ error: "Invalid sign-in request." }, 400);
  }
  if (typeof credential !== "string" || credential.length > 16384) return json({ error: "Invalid sign-in request." }, 400);

  try {
    const identity = await verifySubGoogleIdentity(credential, await googleClientId(), nonce);
    const admin = createAdminClient();
    const { data: access, error } = await admin.from("sub_portal_access")
      .select("id, google_subject").eq("google_email", identity.email).eq("enabled", true).maybeSingle();
    if (error) throw error;
    const denied = () => json({ error: "This Google account does not have an active invitation. Use the email Penney invited, or contact the office." }, 403);
    if (!access || (access.google_subject && access.google_subject !== identity.subject)) return denied();

    if (!access.google_subject) {
      // Claim only an unbound invitation; never replace another Google identity.
      const { error: claimError } = await admin.from("sub_portal_access")
        .update({ google_subject: identity.subject, updated_at: new Date().toISOString() })
        .eq("id", access.id).eq("google_email", identity.email).eq("enabled", true).is("google_subject", null);
      if (claimError) return denied();
    }
    // Recheck after claiming: handles simultaneous sign-ins, revocation and email changes.
    const { data: bound, error: boundError } = await admin.from("sub_portal_access")
      .select("id").eq("id", access.id).eq("google_email", identity.email)
      .eq("google_subject", identity.subject).eq("enabled", true).maybeSingle();
    if (boundError || !bound) return denied();

    const response = json({ ok: true });
    setSubPortalCookie(response, await createSubGoogleSession({ accessId: bound.id, ...identity }));
    response.cookies.set(NONCE_COOKIE, "", { httpOnly: true, path: "/api/sub-portal/google", maxAge: 0 });
    return response;
  } catch (error) {
    const thirdPartyEmail = error instanceof Error && error.message.startsWith("Use an invited Gmail");
    return json({ error: thirdPartyEmail ? error.message : "Google sign-in could not be verified. Reload this page and try again." }, 401);
  }
}
