import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPortalData } from "@/lib/portal/load-portal-data";

export const runtime = "nodejs";

// Service role for public, token-gated access — mirrors /api/approve-change-order.
// The public /portal pages NEVER use the anon key; everything routes through here
// and is validated by the token server-side, so RLS stays intact for the app.
function getPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/portal?token=...
 * Loads the full client-facing project view for one tokenized portal. Only
 * published selection sheets/documents and client-visible decisions are
 * returned; staff see staged content through /api/portal/preview instead.
 */
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

  const supabase = getPublicClient();

  // 1. Validate the portal token.
  const { data: portal, error: portalErr } = await supabase
    .from("client_portal_access")
    .select("id, project_id, client_name, client_email, enabled, view_count")
    .eq("token", token)
    .single();

  if (portalErr || !portal) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });
  }
  if (!portal.enabled) {
    return NextResponse.json({ error: "Access to this portal has been turned off. Please contact Penney Construction." }, { status: 403 });
  }

  // 2. Track navigation, not background schedule refreshes.
  if (new URL(request.url).searchParams.get("refresh") !== "1") await supabase
    .from("client_portal_access")
    .update({
      last_viewed_at: new Date().toISOString(),
      view_count: (portal.view_count || 0) + 1,
    })
    .eq("id", portal.id);

  // 3. Load everything the client is allowed to see.
  const data = await loadPortalData(supabase, {
    projectId: portal.project_id,
    mode: "client",
    token,
    clientName: portal.client_name,
  });
  if (!data) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  return NextResponse.json(data);
}
