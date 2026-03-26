/**
 * Google OAuth2 token management for server-side Google API calls.
 * Reads Google tokens stored in cookies during OAuth callback.
 */

import { cookies } from "next/headers";

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
}

/**
 * Get the current user's Google OAuth access token from cookies.
 * Tokens are stored during the OAuth callback flow.
 */
export async function getGoogleTokens(): Promise<GoogleTokens | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("google-access-token")?.value;

  if (!accessToken) {
    return null;
  }

  return {
    access_token: accessToken,
    refresh_token: cookieStore.get("google-refresh-token")?.value,
  };
}

/**
 * Make an authenticated request to a Google API endpoint.
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

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${tokens.access_token}`);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, { ...options, headers });
}
