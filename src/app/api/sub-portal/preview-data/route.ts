import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSubHome, loadSubJob } from "@/lib/sub-portal/load-sub-portal-data";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/sub-portal/preview-data?subId=…            → SubHomePayload (mode "preview")
 * GET /api/sub-portal/preview-data?subId=…&job=…[&cursor=] → SubJobPayload (mode "preview")
 *
 * The staff preview of a sub's portal (/sub-preview/{subId}), built by the
 * same loader the sub's own GET uses, so it shows exactly what he sees.
 * Office staff only; field logins are refused. Strictly read-only: no portal
 * cookie, no view-count bump, no access row created, nothing written.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.profile || user.profile.role === "field") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const subId = (params.get("subId") || "").trim();
  if (!UUID_RE.test(subId)) return NextResponse.json({ error: "Missing or invalid sub id" }, { status: 400 });

  const supabase = createAdminClient();
  const job = (params.get("job") || "").trim();
  if (job) {
    const result = await loadSubJob({ subId, projectId: job, mode: "preview", cursor: params.get("cursor"), supabase });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
  }

  const data = await loadSubHome({ subId, accessId: null, mode: "preview", supabase });
  if (!data) return NextResponse.json({ error: "Subcontractor not found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
