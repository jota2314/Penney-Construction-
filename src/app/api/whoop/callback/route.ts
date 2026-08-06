import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeWhoopCode,
  saveWhoopTokens,
  getWhoopClientCreds,
} from "@/lib/whoop/auth";

/**
 * WHOOP OAuth — same shape as /api/google-token-exchange.
 *
 * Step 1: GET /api/whoop/callback → redirects to WHOOP consent
 * Step 2: User authorizes → WHOOP redirects back here with ?code=
 * Step 3: Exchange code for tokens, store, land on /whoop
 *
 * The redirect URI registered in the WHOOP dev dashboard must be exactly
 * {origin}/api/whoop/callback (both localhost:3000 and penneyconstruction.build).
 */

const SCOPES = [
  "read:profile",
  "read:recovery",
  "read:cycles",
  "read:sleep",
  "read:workout",
  "read:body_measurement",
  "offline",
].join(" ");

const STATE_COOKIE = "whoop-oauth-state";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!getWhoopClientCreds()) {
    return NextResponse.json({ error: "WHOOP OAuth not configured" }, { status: 500 });
  }

  const redirectUri = `${origin}/api/whoop/callback`;
  const cookieStore = await cookies();

  // Step 1: no code yet — send the user to WHOOP consent
  if (!code) {
    const state = crypto.randomUUID();
    cookieStore.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });

    const authUrl = new URL("https://api.prod.whoop.com/oauth/oauth2/auth");
    authUrl.searchParams.set("client_id", process.env.WHOOP_CLIENT_ID!);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("state", state);

    return NextResponse.redirect(authUrl.toString());
  }

  // Step 2: verify state, exchange code for tokens
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  const returnedState = searchParams.get("state");
  if (!expectedState || expectedState !== returnedState) {
    return NextResponse.redirect(`${origin}/whoop?error=state_mismatch`);
  }
  cookieStore.delete(STATE_COOKIE);

  try {
    const tokens = await exchangeWhoopCode(code, redirectUri);
    if (!tokens) {
      return NextResponse.redirect(`${origin}/whoop?error=token_exchange_failed`);
    }

    await saveWhoopTokens(tokens);
    return NextResponse.redirect(`${origin}/whoop?whoop=connected`);
  } catch {
    return NextResponse.redirect(`${origin}/whoop?error=token_exchange_failed`);
  }
}
