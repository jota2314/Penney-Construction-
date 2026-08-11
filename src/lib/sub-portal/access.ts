import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUB_PORTAL_COOKIE, getSubPortalClient } from "@/lib/sub-portal/auth";

export type SubAccess = {
  supabase: SupabaseClient;
  subId: string;
  accessId: string;
  companyName: string;
  contactName: string | null;
  trades: string[];
};

/**
 * Resolve the signed-in subcontractor from the portal cookie (or ?token=).
 * Every sub-portal API route funnels through this — same service-role +
 * token-validation pattern as the main /api/sub-portal GET.
 */
export async function resolveSubAccess(request: NextRequest): Promise<SubAccess | null> {
  const token =
    request.cookies.get(SUB_PORTAL_COOKIE)?.value ||
    new URL(request.url).searchParams.get("token");
  if (!token) return null;

  const supabase = getSubPortalClient();
  const { data: access } = await supabase
    .from("sub_portal_access")
    .select("id, subcontractor_id, enabled")
    .eq("token", token)
    .maybeSingle();
  if (!access || !access.enabled) return null;

  const { data: sub } = await supabase
    .from("subcontractors")
    .select("company_name, contact_name, trades")
    .eq("id", access.subcontractor_id)
    .maybeSingle();
  if (!sub) return null;

  return {
    supabase,
    subId: access.subcontractor_id,
    accessId: access.id,
    companyName: sub.company_name,
    contactName: sub.contact_name ?? null,
    trades: Array.isArray(sub.trades) ? sub.trades : [],
  };
}

/**
 * Every project this sub touches, from any direction — mirrors the membership
 * derivation in the main portal GET (phases, quotes, bids, awards, invoices,
 * project_subcontractors). Membership only; no dollars leave here.
 */
export async function getSubProjectIds(
  supabase: SupabaseClient,
  subId: string,
): Promise<string[]> {
  const [phases, quotes, bids, awarded, invoices, projSubs] = await Promise.all([
    supabase.from("schedule_phases").select("project_id").contains("assigned_sub_ids", [subId]),
    supabase.from("quote_requests").select("project_id").eq("subcontractor_id", subId),
    supabase
      .from("subcontractor_bids")
      .select("bid_packages(project_id)")
      .eq("subcontractor_id", subId),
    supabase
      .from("estimate_line_items")
      .select("estimates!inner(project_id)")
      .eq("awarded_subcontractor_id", subId),
    supabase.from("invoices").select("project_id").eq("subcontractor_id", subId).not("project_id", "is", null),
    supabase.from("project_subcontractors").select("project_id").eq("subcontractor_id", subId),
  ]);

  const ids = new Set<string>();
  (phases.data || []).forEach((r) => r.project_id && ids.add(r.project_id));
  (quotes.data || []).forEach((r) => r.project_id && ids.add(r.project_id));
  (bids.data || []).forEach((r) => {
    const pkg = Array.isArray(r.bid_packages) ? r.bid_packages[0] : r.bid_packages;
    const pid = (pkg as { project_id?: string } | null)?.project_id;
    if (pid) ids.add(pid);
  });
  (awarded.data || []).forEach((r) => {
    const est = Array.isArray(r.estimates) ? r.estimates[0] : r.estimates;
    const pid = (est as { project_id?: string } | null)?.project_id;
    if (pid) ids.add(pid);
  });
  (invoices.data || []).forEach((r) => r.project_id && ids.add(r.project_id));
  (projSubs.data || []).forEach((r) => r.project_id && ids.add(r.project_id));
  return Array.from(ids);
}
