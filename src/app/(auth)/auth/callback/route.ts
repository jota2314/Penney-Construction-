import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
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

      // Store Google provider tokens in cookies for Google API calls
      if (data.session?.provider_token) {
        response.cookies.set("google-access-token", data.session.provider_token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 3600, // 1 hour — refresh token handles renewal
        });
      }
      if (data.session?.provider_refresh_token) {
        // Cookie: 1 year instead of 30 days
        response.cookies.set("google-refresh-token", data.session.provider_refresh_token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 365, // 1 year
        });

        // Also persist refresh token in DB so it survives cookie expiry
        if (data.session.user?.id) {
          await supabase
            .from("profiles")
            .update({ google_refresh_token: data.session.provider_refresh_token })
            .eq("id", data.session.user.id);
        }
      }

      return response;
    }
  }

  // Auth error — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
