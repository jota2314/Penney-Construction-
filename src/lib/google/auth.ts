/**
 * Google OAuth2 token management for server-side Google API calls.
 * Reads Google tokens stored in cookies during OAuth callback.
 * Falls back to refresh token stored in Supabase profiles table.
 * Automatically refreshes expired access tokens using the refresh token.
 * Google client credentials read from Supabase app_settings (reliable on Vercel).
 */

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
}

/** Read Google client credentials — env vars first, Supabase fallback */
async function getGoogleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (clientId && clientSecret) return { clientId, clientSecret };

  // Env vars missing (Vercel issue) — read from Supabase
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["google_client_id", "google_client_secret"]);
    const get = (key: string) => data?.find((s) => s.key === key)?.value || "";
    const dbClientId = get("google_client_id");
    const dbClientSecret = get("google_client_secret");
    if (dbClientId && dbClientSecret) return { clientId: dbClientId, clientSecret: dbClientSecret };
  } catch {
    // DB lookup failed
  }

  return null;
}

/**
 * Get the refresh token for the CURRENT user.
 * Always uses the DB (user-specific) token as source of truth.
 * Cookie is just a cache — verified against the current user.
 */
async function getRefreshToken(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // Always get the current user's token from DB (source of truth)
    const { data: profile } = await supabase
      .from("profiles")
      .select("google_refresh_token")
      .eq("id", user.id)
      .single();

    if (profile?.google_refresh_token) {
      // Cache in cookie for this user
      try {
        const cookieStore = await cookies();
        cookieStore.set("google-refresh-token", profile.google_refresh_token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        });
      } catch {
        // Cookie write may fail in some contexts
      }
      return profile.google_refresh_token;
    }

    // No DB token — check cookie as last resort (new user who just connected)
    const cookieStore = await cookies();
    return cookieStore.get("google-refresh-token")?.value || null;
  } catch {
    // DB lookup failed — try cookie
    try {
      const cookieStore = await cookies();
      return cookieStore.get("google-refresh-token")?.value || null;
    } catch {
      return null;
    }
  }
}

/**
 * Get the current user's Google OAuth access token from cookies.
 * If the access token is missing but a refresh token exists, refreshes automatically.
 */
export async function getGoogleTokens(): Promise<GoogleTokens | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("google-access-token")?.value;
  const refreshToken = await getRefreshToken();

  if (accessToken) {
    return { access_token: accessToken, refresh_token: refreshToken || undefined };
  }

  // Access token expired — try to refresh
  if (refreshToken) {
    const creds = await getGoogleCredentials();
    if (creds) {
      const newTokens = await refreshAccessToken(refreshToken, creds.clientId, creds.clientSecret);
      if (newTokens) {
        try {
          cookieStore.set("google-access-token", newTokens.access_token, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
            maxAge: newTokens.expires_in || 3600,
          });
        } catch {
          // Cookie write failed — token still returned in memory
        }
        return { access_token: newTokens.access_token, refresh_token: refreshToken };
      }
    }
  }

  return null;
}

/**
 * Refresh the Google access token using the refresh token.
 */
async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ access_token: string; expires_in: number } | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (data.access_token) {
      return {
        access_token: data.access_token,
        expires_in: data.expires_in || 3600,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Make an authenticated request to a Google API endpoint.
 * Automatically retries once with a refreshed token if the first attempt gets a 401.
 */
export async function googleFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const tokens = await getGoogleTokens();

  if (!tokens) {
    throw new Error(
      "No Google OAuth tokens available. User must sign in with Google and grant API permissions."
    );
  }

  const makeRequest = (accessToken: string) => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    if (!headers.has("Content-Type") && options.body) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(url, { ...options, headers });
  };

  const response = await makeRequest(tokens.access_token);

  // If 401, try refreshing and retry once
  if (response.status === 401 && tokens.refresh_token) {
    const creds = await getGoogleCredentials();
    if (creds) {
      const newTokens = await refreshAccessToken(tokens.refresh_token, creds.clientId, creds.clientSecret);
      if (newTokens) {
        try {
          const cookieStore = await cookies();
          cookieStore.set("google-access-token", newTokens.access_token, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
            maxAge: newTokens.expires_in || 3600,
          });
        } catch {
          // Cookie write may fail — still use the token
        }
        return makeRequest(newTokens.access_token);
      }
    }
  }

  return response;
}
