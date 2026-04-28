/**
 * Server-side Google auth helpers that don't depend on cookies/session.
 * Used by cron jobs and other background tasks.
 */

import { createAdminClient } from "@/lib/supabase/admin";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

async function getGoogleClientCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (clientId && clientSecret) return { clientId, clientSecret };

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["google_client_id", "google_client_secret"]);
  const get = (key: string) => data?.find((s) => s.key === key)?.value || "";
  const dbClientId = get("google_client_id");
  const dbClientSecret = get("google_client_secret");
  if (dbClientId && dbClientSecret) return { clientId: dbClientId, clientSecret: dbClientSecret };

  return null;
}

export async function getAccessTokenFromRefreshToken(refreshToken: string): Promise<string | null> {
  const creds = await getGoogleClientCredentials();
  if (!creds) {
    console.error("[google-server-auth] no client credentials (env + app_settings both empty)");
    return null;
  }

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<no body>");
      console.error(`[google-server-auth] refresh failed (${res.status}) clientId=${creds.clientId.slice(0, 12)}…: ${body}`);
      return null;
    }
    const data = await res.json();
    return data.access_token || null;
  } catch (err) {
    console.error(`[google-server-auth] refresh threw: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function googleFetchWithToken(
  url: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...options, headers });
}
