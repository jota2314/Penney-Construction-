import { createAdminClient } from "@/lib/supabase/admin";

const QB_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// This module always uses the admin client: the OAuth callback is a top-level
// redirect from Intuit and may arrive without a Supabase session cookie, in
// which case the RLS-scoped client silently reads zero rows (empty creds →
// "invalid_client") and its writes update nothing.

async function getSettings(keys: string[]) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", keys);
  if (error) throw new Error(`Failed to read QB settings: ${error.message}`);
  return (key: string) => data?.find((s) => s.key === key)?.value || "";
}

/** Read QB credentials from app_settings (bypasses Vercel env var issues) */
async function getQBCredentials() {
  const get = await getSettings([
    "quickbooks_client_id",
    "quickbooks_client_secret",
    "quickbooks_redirect_uri",
  ]);
  const creds = {
    clientId: get("quickbooks_client_id"),
    clientSecret: get("quickbooks_client_secret"),
    redirectUri: get("quickbooks_redirect_uri"),
  };
  if (!creds.clientId || !creds.clientSecret || !creds.redirectUri) {
    throw new Error(
      "QuickBooks credentials missing in app_settings (client id/secret/redirect uri)"
    );
  }
  return creds;
}

/** Build the Intuit OAuth authorization URL */
export async function getAuthUrl(state?: string) {
  const { clientId, redirectUri } = await getQBCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    state: state || "connect",
  });
  return `${QB_AUTH_URL}?${params.toString()}`;
}

/** Exchange authorization code for access + refresh tokens */
export async function exchangeCodeForTokens(code: string, realmId: string) {
  const { clientId, clientSecret, redirectUri } = await getQBCredentials();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  // TEMPORARY diagnostics for the invalid_client investigation — logs no secrets.
  console.log("QB exchange:", JSON.stringify({
    codePrefix: code.slice(0, 8),
    codeLen: code.length,
    realmId,
    clientIdPrefix: clientId.slice(0, 12),
    secretLen: clientSecret.length,
    redirectUri,
  }));

  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.log("QB exchange failed:", res.status, err.slice(0, 300));
    throw new Error(`QB token exchange failed: ${err}`);
  }

  const data = await res.json();

  await storeTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    realmId,
  });

  return data;
}

/** Refresh an expired access token */
export async function refreshAccessToken() {
  const get = await getSettings([
    "quickbooks_refresh_token",
    "quickbooks_realm_id",
    "quickbooks_client_id",
    "quickbooks_client_secret",
  ]);

  const refreshToken = get("quickbooks_refresh_token");
  if (!refreshToken) throw new Error("No QB refresh token found");

  const basicAuth = Buffer.from(`${get("quickbooks_client_id")}:${get("quickbooks_client_secret")}`).toString("base64");

  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`QB token refresh failed: ${err}`);
  }

  const data = await res.json();
  const realmId = get("quickbooks_realm_id");

  await storeTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    realmId,
  });

  return data.access_token as string;
}

/** Store QB tokens in app_settings table */
async function storeTokens(opts: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  realmId: string;
}) {
  const supabase = createAdminClient();
  const expiresAt = new Date(Date.now() + opts.expiresIn * 1000).toISOString();

  const updates = [
    { key: "quickbooks_access_token", value: opts.accessToken },
    { key: "quickbooks_refresh_token", value: opts.refreshToken },
    { key: "quickbooks_token_expires_at", value: expiresAt },
    { key: "quickbooks_realm_id", value: opts.realmId },
  ];

  const { error } = await supabase
    .from("app_settings")
    .upsert(updates, { onConflict: "key" });
  if (error) throw new Error(`Failed to store QB tokens: ${error.message}`);
}

/** Get a valid access token (refreshes if expired) */
export async function getValidAccessToken(): Promise<{ accessToken: string; realmId: string }> {
  const get = await getSettings([
    "quickbooks_access_token",
    "quickbooks_refresh_token",
    "quickbooks_token_expires_at",
    "quickbooks_realm_id",
  ]);

  const realmId = get("quickbooks_realm_id");
  const expiresAt = get("quickbooks_token_expires_at");
  let accessToken = get("quickbooks_access_token");

  if (!accessToken || !realmId) {
    throw new Error("QuickBooks not connected. Go to Settings to connect.");
  }

  if (expiresAt && new Date(expiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
    accessToken = await refreshAccessToken();
  }

  return { accessToken, realmId };
}

/** Check if QuickBooks is connected */
export async function isQuickBooksConnected(): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "quickbooks_realm_id")
    .single();
  return !!(data?.value);
}
