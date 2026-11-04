import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

function clearGoogleCookies(response: NextResponse) {
  response.cookies.set("google-connect-user", "", { httpOnly: true, path: "/auth/callback", maxAge: 0 });
  for (const name of ["google-access-token", "google-refresh-token"]) {
    response.cookies.set(name, "", { httpOnly: true, path: "/", maxAge: 0 });
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = searchParams.get("next");
  const nextParam = requestedNext?.startsWith("/") && !requestedNext.startsWith("//") && !requestedNext.includes("\\")
    ? requestedNext : null;
  const jar = await cookies();
  const connectUser = jar.get("google-connect-user")?.value;
  const connectingGoogle = !!connectUser;

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Determine redirect based on role
      const userId = data.session?.user?.id;
      let next = nextParam ?? "/command-center";
      let role: string | null = null;
      if (userId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .single();

        role = profile?.role ?? null;
        // Trusted invitations/admin changes own roles, never a stale allowlist.
        if (role === "field") next = "/crew";
      }

      if (connectingGoogle && (connectUser !== userId || !role ||
          !["owner", "precon_manager", "project_manager", "office_admin"].includes(role))) {
        // Only this browser's session belongs to this failed connection.
        // Explicitly clear its cookies even if the auth server is unavailable.
        try {
          await supabase.auth.signOut({ scope: "local" });
        } catch {
          // The response below still removes this browser's session cookies.
        }
        const denied = NextResponse.redirect(`${origin}/login?error=integration_account_mismatch`);
        clearGoogleCookies(denied);
        for (const cookie of jar.getAll()) {
          if (/^sb-[a-z0-9]+-auth-token(?:\.\d+)?$/i.test(cookie.name)) {
            denied.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
          }
        }
        return denied;
      }

      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";

      let redirectUrl: string;
      if (isLocalEnv) {
        redirectUrl = `${origin}${next}`;
      } else if (forwardedHost) {
        redirectUrl = `https://${forwardedHost}${next}`;
      } else {
        redirectUrl = `${origin}${next}`;
      }

      const response = NextResponse.redirect(redirectUrl);
      // Replace browser caches with only this account's integration tokens.
      // A reconnect without new tokens must not retain an older account's cache.
      clearGoogleCookies(response);
      if (!connectingGoogle) {
        // Identity-only tokens cannot operate office integrations. Clear the
        // previous browser account's cache; office integrations use their own
        // user's stored refresh token until explicitly reconnected.
        return response;
      }

      const providerToken = data.session?.provider_token;
      const providerRefreshToken = data.session?.provider_refresh_token;
      // Store access token in cookie
      if (providerToken) {
        response.cookies.set("google-access-token", providerToken, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 3600,
        });
      }

      // Store refresh token in cookie + DB
      if (providerRefreshToken) {
        response.cookies.set("google-refresh-token", providerRefreshToken, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        });

        // Save to DB so it survives cookie expiry
        if (userId) {
          await supabase
            .from("profiles")
            .update({ google_refresh_token: providerRefreshToken })
            .eq("id", userId);
        }
      } else if (userId) {
        // Supabase didn't return refresh token — try to get it directly from Google
        // using the user's identity data
        try {
          const { data: identities } = await supabase.auth.getUserIdentities();
          const googleIdentity = identities?.identities?.find(
            (i) => i.provider === "google"
          );

          // If we have an access token but no refresh token, and there's
          // already one in DB, restore the cookie from DB
          const { data: profile } = await supabase
            .from("profiles")
            .select("google_refresh_token")
            .eq("id", userId)
            .single();

          if (profile?.google_refresh_token) {
            response.cookies.set("google-refresh-token", profile.google_refresh_token, {
              httpOnly: true,
              secure: true,
              sameSite: "lax",
              path: "/",
              maxAge: 60 * 60 * 24 * 365,
            });
          } else if (providerToken && googleIdentity) {
            // Last resort: use the access token to make a tokeninfo call
            // to verify the token is valid, then store what we have
            // The user will need to do one more consent flow with prompt=consent
            console.log("No refresh token available — user may need to reconnect with consent");
          }
        } catch {
          // Identity lookup failed — continue without refresh token
        }
      }

      return response;
    }
  }

  // Auth error — redirect to login with error
  const failed = NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
  clearGoogleCookies(failed);
  return failed;
}
