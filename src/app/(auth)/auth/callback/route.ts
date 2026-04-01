import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Determine redirect based on role
      const userId = data.session?.user?.id;
      let next = nextParam ?? "/command-center";
      if (userId && !nextParam) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .single();
        if (profile?.role === "field") {
          next = "/crew";
        }
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
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
