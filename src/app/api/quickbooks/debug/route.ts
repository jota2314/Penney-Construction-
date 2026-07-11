import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// TEMPORARY diagnostic route — remove after the QuickBooks connection issue
// is resolved. Reads the same credentials the OAuth callback uses and probes
// Intuit's token endpoint with a bogus code: valid credentials return
// invalid_grant, wrong credentials return invalid_client.

const GUARD = "qbdebug-3f61b2a9c8d54e07";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("t") !== GUARD) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const supabaseHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").host;
    } catch {
      return "unset";
    }
  })();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["quickbooks_client_id", "quickbooks_client_secret", "quickbooks_redirect_uri"]);

  const get = (k: string) => data?.find((s) => s.key === k)?.value || "";
  const clientId = get("quickbooks_client_id");
  const clientSecret = get("quickbooks_client_secret");
  const redirectUri = get("quickbooks_redirect_uri");

  let intuitStatus: number | null = null;
  let intuitBody: string | null = null;
  if (clientId && clientSecret) {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "bogus_debug_code",
        redirect_uri: redirectUri,
      }),
    });
    intuitStatus = res.status;
    intuitBody = await res.text();
  }

  return NextResponse.json({
    supabaseHost,
    readError: error?.message || null,
    rowsFound: data?.map((r) => r.key) || [],
    clientIdPrefix: clientId.slice(0, 12),
    clientIdLen: clientId.length,
    secretSha256Prefix: clientSecret
      ? createHash("sha256").update(clientSecret).digest("hex").slice(0, 10)
      : null,
    secretLen: clientSecret.length,
    redirectUri,
    intuitStatus,
    intuitBody,
  });
}
