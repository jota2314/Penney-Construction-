import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUB_PORTAL_COOKIE, SUB_PORTAL_COOKIE_MAX_AGE } from "@/lib/sub-portal/auth";

export const runtime = "nodejs";

/**
 * GET /api/sub-portal/preview?sub=<subcontractor id>
 *
 * Office-only "view as this sub": a signed-in Penney user gets the sub's
 * portal cookie set and lands on /sub/portal exactly as the sub would see it.
 * Never touches the sub's PIN (which is hashed and cannot be read back), so
 * checking his portal doesn't lock him out. Creates the access row if the sub
 * has never been set up — without a PIN, so it does not open a login.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  const subId = (request.nextUrl.searchParams.get("sub") || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(subId)) {
    return NextResponse.json({ error: "Missing or invalid sub id" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: sub } = await supabase
    .from("subcontractors")
    .select("id, company_name")
    .eq("id", subId)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: "Subcontractor not found" }, { status: 404 });

  let { data: access } = await supabase
    .from("sub_portal_access")
    .select("id, token, enabled")
    .eq("subcontractor_id", subId)
    .maybeSingle();

  if (!access) {
    const { data: created, error } = await supabase
      .from("sub_portal_access")
      .insert({ subcontractor_id: subId, created_by: user.id })
      .select("id, token, enabled")
      .single();
    if (error || !created) {
      return NextResponse.json({ error: error?.message || "Couldn't create portal access" }, { status: 500 });
    }
    access = created;
  }

  if (!access.enabled) {
    return NextResponse.json(
      { error: `Portal access for ${sub.company_name} is turned off. Turn it on from the sub's Portal dialog first.` },
      { status: 403 },
    );
  }

  const res = NextResponse.redirect(new URL("/sub/portal", request.url));
  res.cookies.set(SUB_PORTAL_COOKIE, access.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SUB_PORTAL_COOKIE_MAX_AGE,
  });
  return res;
}
