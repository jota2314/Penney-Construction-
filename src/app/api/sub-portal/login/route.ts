import { NextRequest, NextResponse } from "next/server";
import {
  SUB_PORTAL_COOKIE,
  SUB_PORTAL_COOKIE_MAX_AGE,
  getSubPortalClient,
  hashPin,
  normalizePhone,
} from "@/lib/sub-portal/auth";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 8;
const LOCKOUT_MINUTES = 15;

/**
 * POST /api/sub-portal/login  { phone, pin }
 * Phone + 4-digit PIN → httpOnly token cookie. Generic error on every failure
 * path so the response never reveals which half was wrong.
 */
export async function POST(request: NextRequest) {
  let body: { phone?: string; pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const phone = normalizePhone(body.phone || "");
  const pin = (body.pin || "").trim();
  if (phone.length < 10 || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json(
      { error: "Enter your phone number and PIN." },
      { status: 400 }
    );
  }

  const supabase = getSubPortalClient();
  const { data: access } = await supabase
    .from("sub_portal_access")
    .select("id, token, pin_hash, enabled, failed_attempts, locked_until")
    .eq("phone_login", phone)
    .maybeSingle();

  const failure = NextResponse.json(
    { error: "That phone number and PIN don't match. Call the Penney office if you need a reset." },
    { status: 401 }
  );

  if (!access || !access.enabled || !access.pin_hash) return failure;

  if (access.locked_until && new Date(access.locked_until) > new Date()) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 }
    );
  }

  if (hashPin(access.token, pin) !== access.pin_hash) {
    const attempts = (access.failed_attempts || 0) + 1;
    await supabase
      .from("sub_portal_access")
      .update({
        failed_attempts: attempts,
        locked_until:
          attempts >= MAX_ATTEMPTS
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
            : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", access.id);
    return failure;
  }

  await supabase
    .from("sub_portal_access")
    .update({ failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() })
    .eq("id", access.id);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SUB_PORTAL_COOKIE, access.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SUB_PORTAL_COOKIE_MAX_AGE,
  });
  return res;
}

/** DELETE /api/sub-portal/login — sign out (clears the cookie). */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SUB_PORTAL_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
