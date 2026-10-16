import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import { loadPortalData } from "@/lib/portal/load-portal-data";

export const runtime = "nodejs";

/**
 * GET /api/portal/preview?projectId=...
 * Staff-only preview of a project's client portal, INCLUDING staged selection
 * sheets/documents and hidden decisions (flagged so the page marks them
 * DRAFT). Works before a portal link exists and never touches the client's
 * view counters. Field crew are refused.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.profile || user.profile.role === "field") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: portal } = await supabase
    .from("client_portal_access")
    .select("client_name, client_email, enabled, link_sent_at, view_count")
    .eq("project_id", projectId)
    .maybeSingle();

  // No portal yet: preview as the project's primary customer.
  let clientName = portal?.client_name ?? null;
  if (!clientName) {
    const { data: proj } = await supabase
      .from("projects")
      .select("customers(first_name, last_name)")
      .eq("id", projectId)
      .maybeSingle();
    const c = (proj?.customers ?? null) as { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null;
    const cust = Array.isArray(c) ? c[0] : c;
    clientName = cust ? `${cust.first_name ?? ""} ${cust.last_name ?? ""}`.trim() || null : null;
  }

  const data = await loadPortalData(supabase, { projectId, mode: "preview", clientName });
  if (!data) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  data.portal = {
    exists: !!portal,
    enabled: portal?.enabled ?? false,
    client_email: portal?.client_email ?? null,
    link_sent_at: portal?.link_sent_at ?? null,
    view_count: portal?.view_count ?? 0,
  };
  return NextResponse.json(data);
}
