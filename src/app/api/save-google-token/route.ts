import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/save-google-token
 * Accepts a Google refresh token and saves it to the user's profile + cookie.
 * Used as a fallback when Supabase doesn't pass the token through.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { refresh_token } = await request.json();
  if (!refresh_token)
    return NextResponse.json({ error: "refresh_token required" }, { status: 400 });

  // Save to DB
  await supabase
    .from("profiles")
    .update({ google_refresh_token: refresh_token })
    .eq("id", user.id);

  // Save to cookie
  const cookieStore = await cookies();
  cookieStore.set("google-refresh-token", refresh_token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ success: true });
}

/**
 * GET /api/save-google-token
 * Check current token status.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const cookieStore = await cookies();
  const hasAccessCookie = !!cookieStore.get("google-access-token")?.value;
  const hasRefreshCookie = !!cookieStore.get("google-refresh-token")?.value;

  const { data: profile } = await supabase
    .from("profiles")
    .select("google_refresh_token")
    .eq("id", user.id)
    .single();

  const hasDbToken = !!profile?.google_refresh_token;

  return NextResponse.json({
    hasAccessCookie,
    hasRefreshCookie,
    hasDbToken,
    userId: user.id,
  });
}
