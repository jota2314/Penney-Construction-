/**
 * Google OAuth2 token management for server-side Google API calls.
 * Uses the authenticated user's Google OAuth tokens stored in Supabase.
 */

import { createClient } from "@/lib/supabase/server";

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

/**
 * Get the current user's Google OAuth access token from Supabase session.
 * Supabase stores the provider token when using Google OAuth.
 */
export async function getGoogleTokens(): Promise<GoogleTokens | null> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.provider_token) {
    return null;
  }

  return {
    access_token: session.provider_token,
    refresh_token: session.provider_refresh_token ?? undefined,
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
