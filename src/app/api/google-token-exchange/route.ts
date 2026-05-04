import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * Direct Google token exchange — bypasses Supabase to guarantee
 * we get the refresh token. Called from the settings page.
 *
 * Step 1: GET /api/google-token-exchange → returns Google OAuth URL
 * Step 2: User authorizes → redirected back with ?code=
 * Step 3: This route exchanges the code for tokens
 */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// drive.file alone only grants access to files the app itself created.
// drive.readonly is what lets us fetch Drive links found in inbound
// emails (Google Docs / Sheets the sender owns). Both scopes together =
// "read everything the user can read, write only what we made."
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
].join(" ");

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 500 });
  }

  const redirectUri = `${origin}/api/google-token-exchange`;

  // Step 1: No code yet — redirect user to Google consent
  if (!code) {
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");

    return NextResponse.redirect(authUrl.toString());
  }

  // Step 2: Exchange code for tokens directly with Google
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokens.access_token) {
      return NextResponse.redirect(`${origin}/settings?error=token_exchange_failed`);
    }

    // Save tokens
    const cookieStore = await cookies();

    cookieStore.set("google-access-token", tokens.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: tokens.expires_in || 3600,
    });

    if (tokens.refresh_token) {
      cookieStore.set("google-refresh-token", tokens.refresh_token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });

      // Save to DB
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("profiles")
          .update({ google_refresh_token: tokens.refresh_token })
          .eq("id", user.id);
      }
    }

    return NextResponse.redirect(`${origin}/command-center/emails?google=connected`);
  } catch {
    return NextResponse.redirect(`${origin}/settings?error=token_exchange_failed`);
  }
}
