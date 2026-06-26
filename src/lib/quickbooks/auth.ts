import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getQBApiBase } from "./client";

const QB_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// OAuth scopes. accounting is required for all REST entities (customers,
// invoices, etc.). When we add real QB Projects (GraphQL) later we will also
// need "project-management.project" here and a reconnect.
const QB_SCOPE = "com.intuit.quickbooks.accounting";

/** A Supabase client (server-cookie or admin/service-role). */
type Supa = SupabaseClient;

async function getDb(supabase?: Supa): Promise<Supa> {
  return supabase ?? ((await createClient()) as unknown as Supa);
}

/** Active QB environment: "sandbox" or "production" (default production). */
export async function getQBEnvironment(supabase?: Supa): Promise<"sandbox" | "production"> {
  const db = await getDb(supabase);
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "quickbooks_environment")
    .maybeSingle();
  return data?.value === "sandbox" ? "sandbox" : "production";
}

/**
 * Read QB OAuth credentials from app_settings (bypasses Vercel env var issues).
 * In sandbox we prefer the Intuit app's Development keys
 * (quickbooks_sandbox_*), falling back to the production keys if not set.
 */
async function getQBCredentials(supabase: Supa, environment: "sandbox" | "production") {
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "quickbooks_client_id",
      "quickbooks_client_secret",
      "quickbooks_redirect_uri",
      "quickbooks_sandbox_client_id",
      "quickbooks_sandbox_client_secret",
      "quickbooks_sandbox_redirect_uri",
    ]);

  const get = (key: string) => data?.find((s) => s.key === key)?.value || "";
  const sandbox = environment === "sandbox";
  return {
    clientId: (sandbox && get("quickbooks_sandbox_client_id")) || get("quickbooks_client_id"),
    clientSecret:
      (sandbox && get("quickbooks_sandbox_client_secret")) || get("quickbooks_client_secret"),
    redirectUri:
      (sandbox && get("quickbooks_sandbox_redirect_uri")) || get("quickbooks_redirect_uri"),
  };
}

/** Build the Intuit OAuth authorization URL */
export async function getAuthUrl(state?: string) {
  const db = await getDb();
  const environment = await getQBEnvironment(db);
  const { clientId, redirectUri } = await getQBCredentials(db, environment);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: QB_SCOPE,
    state: state || "connect",
  });
  return `${QB_AUTH_URL}?${params.toString()}`;
}

/** Exchange authorization code for access + refresh tokens */
export async function exchangeCodeForTokens(code: string, realmId: string) {
  const db = await getDb();
  const environment = await getQBEnvironment(db);
  const { clientId, clientSecret, redirectUri } = await getQBCredentials(db, environment);
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

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
    throw new Error(`QB token exchange failed: ${err}`);
  }

  const data = await res.json();

  await storeTokens(
    {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      realmId,
    },
    db
  );

  return data;
}

/** Refresh an expired access token */
export async function refreshAccessToken(supabase?: Supa) {
  const db = await getDb(supabase);
  const environment = await getQBEnvironment(db);
  const { data: settings } = await db
    .from("app_settings")
    .select("key, value")
    .in("key", ["quickbooks_refresh_token", "quickbooks_realm_id"]);

  const get = (key: string) => settings?.find((s) => s.key === key)?.value || "";

  const refreshToken = get("quickbooks_refresh_token");
  if (!refreshToken) throw new Error("No QB refresh token found");

  const { clientId, clientSecret } = await getQBCredentials(db, environment);
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

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

  await storeTokens(
    {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      realmId,
    },
    db
  );

  return data.access_token as string;
}

/** Store QB tokens in app_settings table */
async function storeTokens(
  opts: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    realmId: string;
  },
  supabase?: Supa
) {
  const db = await getDb(supabase);
  const expiresAt = new Date(Date.now() + opts.expiresIn * 1000).toISOString();

  const updates = [
    { key: "quickbooks_access_token", value: opts.accessToken },
    { key: "quickbooks_refresh_token", value: opts.refreshToken },
    { key: "quickbooks_token_expires_at", value: expiresAt },
    { key: "quickbooks_realm_id", value: opts.realmId },
  ];

  for (const u of updates) {
    await db.from("app_settings").update({ value: u.value }).eq("key", u.key);
  }
}

/** Get a valid access token (refreshes if expired) + the active environment's API base. */
export async function getValidAccessToken(
  supabase?: Supa
): Promise<{ accessToken: string; realmId: string; environment: "sandbox" | "production"; baseUrl: string }> {
  const db = await getDb(supabase);
  const environment = await getQBEnvironment(db);
  const { data: settings } = await db
    .from("app_settings")
    .select("key, value")
    .in("key", ["quickbooks_access_token", "quickbooks_token_expires_at", "quickbooks_realm_id"]);

  const get = (key: string) => settings?.find((s) => s.key === key)?.value || "";

  const realmId = get("quickbooks_realm_id");
  const expiresAt = get("quickbooks_token_expires_at");
  let accessToken = get("quickbooks_access_token");

  if (!accessToken || !realmId) {
    throw new Error("QuickBooks not connected. Go to Settings to connect.");
  }

  if (expiresAt && new Date(expiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
    accessToken = await refreshAccessToken(db);
  }

  return { accessToken, realmId, environment, baseUrl: getQBApiBase(environment) };
}

/** Check if QuickBooks is connected */
export async function isQuickBooksConnected(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "quickbooks_realm_id")
    .single();
  return !!(data?.value);
}
