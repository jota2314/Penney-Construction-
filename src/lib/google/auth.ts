/**
 * Google OAuth2 token management for server-side Google API calls.
 * Reads Google tokens stored in cookies during OAuth callback.
 * Automatically refreshes expired access tokens using the refresh token.
 */

import { cookies } from "next/headers";

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

/**
 * Get the current user's Google OAuth access token from cookies.
 * If the access token is missing but a refresh token exists, refreshes automatically.
 */
export async function getGoogleTokens(): Promise<GoogleTokens | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("google-access-token")?.value;
  const refreshToken = cookieStore.get("google-refresh-token")?.value;

  if (accessToken) {
    return { access_token: accessToken, refresh_token: refreshToken };
  }

  // Access token expired — try to refresh using the refresh token
  if (refreshToken && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    const newTokens = await refreshAccessToken(refreshToken);
    if (newTokens) {
      // Store the new access token in cookies
      cookieStore.set("google-access-token", newTokens.access_token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: newTokens.expires_in || 3600,
      });
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
      const cookieStore = await cookies();
      cookieStore.set("google-access-token", newTokens.access_token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: newTokens.expires_in || 3600,
      });
      return makeRequest(newTokens.access_token);
    }
  }

  return response;
}
