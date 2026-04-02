/**
 * Google OAuth2 token management for server-side Google API calls.
 * Reads Google tokens stored in cookies during OAuth callback.
 * Falls back to refresh token stored in Supabase profiles table.
 * Automatically refreshes expired access tokens using the refresh token.
 */

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

/**
 * Get the refresh token — try cookie first, then fall back to DB.
 */
async function getRefreshToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get("google-refresh-token")?.value;
  if (cookieToken) return cookieToken;

  // Cookie expired — try DB
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("google_refresh_token")
      .eq("id", user.id)
      .single();

    if (profile?.google_refresh_token) {
      // Try to restore the cookie so we don't hit DB every time
      try {
        cookieStore.set("google-refresh-token", profile.google_refresh_token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        });
      } catch {
        // Cookie write may fail in some contexts — that's OK
      }
      return profile.google_refresh_token;
    }
  } catch {
    // DB lookup failed — no refresh token available
  }

  return null;
}

/**
 * Get the current user's Google OAuth access token from cookies.
 * If the access token is missing but a refresh token exists, refreshes automatically.
 * Note: Cookie writes may silently fail in some Next.js contexts (server components,
 * cached routes), so we always return the token even if we can't cache it.
 */
export async function getGoogleTokens(): Promise<GoogleTokens | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("google-access-token")?.value;
  const refreshToken = await getRefreshToken();

  if (accessToken) {
    return { access_token: accessToken, refresh_token: refreshToken || undefined };
  }

  // Access token expired — try to refresh using the refresh token
  if (refreshToken && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    const newTokens = await refreshAccessToken(refreshToken);
    if (newTokens) {
      // Try to cache in cookie (may silently fail in some contexts)
      try {
        cookieStore.set("google-access-token", newTokens.access_token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: newTokens.expires_in || 3600,
        });
      } catch {
        // Cookie write failed (e.g. server component context) — that's OK,
        // we still have the token in memory for this request
      }
      return { access_token: newTokens.access_token, refresh_token: refreshToken };
    }
  }

  return null;
}

/**
 * Refresh the Google access token using the refresh token.
 */
async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number } | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
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

  // If we get a 401 and have a refresh token, try refreshing and retry once
  if (response.status === 401 && tokens.refresh_token && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    const newTokens = await refreshAccessToken(tokens.refresh_token);
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
        // Cookie write may fail in some contexts — still use the token
      }
      return makeRequest(newTokens.access_token);
    }
  }

  return response;
}
