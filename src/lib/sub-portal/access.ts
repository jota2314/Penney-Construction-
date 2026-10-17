import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUB_PORTAL_COOKIE, getSubPortalClient } from "@/lib/sub-portal/auth";
import { SUB_AGREEMENT_AWAITING_SIGN, SUB_AWARDED_QUOTE_STATUSES } from "@/lib/sub-portal/statuses";

export type SubAccess = {
  supabase: SupabaseClient;
  subId: string;
  accessId: string;
  companyName: string;
  contactName: string | null;
  trades: string[];
  /** sub_portal_access.last_viewed_at, for the GET's 30-minute view debounce. */
  lastViewedAt: string | null;
  viewCount: number;
};

export type SubAccessResult =
  | { ok: true; access: SubAccess }
  | { ok: false; status: 401 | 403; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The portal token on this request: the login cookie, else a legacy ?token=.
 *
 * The ?token= fallback stays until 30 days of production logs show nobody
 * uses it (plan §4.6). Nothing in the app hands out token links any more;
 * the warning below is how that check gets made. It never prints the token.
 */
export function readSubPortalToken(request: NextRequest): string | null {
  const cookie = request.cookies.get(SUB_PORTAL_COOKIE)?.value;
  if (cookie) return cookie;
  const fromQuery = request.nextUrl.searchParams.get("token");
  if (fromQuery) {
    console.warn("[sub-portal] legacy ?token= fallback used", request.nextUrl.pathname);
    return fromQuery;
  }
  return null;
}

/**
 * Resolve the signed-in subcontractor, saying why when it can't: not signed
 * in (401) or his access was turned off (403). The GET routes use this to
 * show the right message; POST routes can keep using resolveSubAccess.
 */
export async function resolveSubAccessResult(request: NextRequest): Promise<SubAccessResult> {
  const token = readSubPortalToken(request);
  // The token column is a uuid; anything else can't match and isn't worth a query.
  if (!token || !UUID_RE.test(token)) return { ok: false, status: 401, error: "Not signed in" };

  const supabase = getSubPortalClient();
  const { data: access } = await supabase
    .from("sub_portal_access")
    .select("id, subcontractor_id, enabled, last_viewed_at, view_count")
    .eq("token", token)
    .maybeSingle();
  if (!access) return { ok: false, status: 401, error: "Not signed in" };
  if (!access.enabled) {
    return { ok: false, status: 403, error: "Portal access has been turned off. Contact Penney Construction." };
  }

  const { data: sub } = await supabase
    .from("subcontractors")
    .select("company_name, contact_name, trades")
    .eq("id", access.subcontractor_id)
    .maybeSingle();
  if (!sub) return { ok: false, status: 401, error: "Not signed in" };

  return {
    ok: true,
    access: {
      supabase,
      subId: access.subcontractor_id,
      accessId: access.id,
      companyName: sub.company_name,
      contactName: sub.contact_name ?? null,
      trades: Array.isArray(sub.trades) ? sub.trades : [],
      lastViewedAt: access.last_viewed_at ?? null,
      viewCount: Number(access.view_count ?? 0),
    },
  };
}

/**
 * Resolve the signed-in subcontractor from the portal cookie (or the legacy
 * ?token=). Every sub-portal API route funnels through this. Null when not
 * signed in or turned off.
 */
export async function resolveSubAccess(request: NextRequest): Promise<SubAccess | null> {
  const result = await resolveSubAccessResult(request);
  return result.ok ? result.access : null;
}

/**
 * Every project this sub touches, from any direction (phases, quotes, bids,
 * awards, invoices, project_subcontractors), whatever the job's status.
 * Membership only; no dollars leave here.
 *
 * This is the broad v2 list. To decide whether he may post, clock or
 * check in on a job, use isSubOnJob from active-jobs.ts (the one active-job
 * rule the portal shows).
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

/**
 * The jobs he has a real tie to, for billing: an award (accepted or approved
 * quote, accepted bid, awarded estimate line off a non-option estimate), a
 * bill of his on file, an active contract link, an agreement sent, opened or
 * signed, or a phase the office put him on. Whatever the job's status, so a
 * final invoice still lands after the job closes.
 *
 * Narrower than getSubProjectIds on purpose: a quote or bid that was never
 * awarded, a phase he proposed himself and a QR 'visit_only' link are not on
 * it. A losing bidder can't send an invoice on a job and ride that
 * submission onto the job screen.
 */
export async function getSubBillableProjectIds(
  supabase: SupabaseClient,
  subId: string,
): Promise<string[]> {
  const [phases, quotes, bids, lines, invoices, projSubs, agreements] = await Promise.all([
    supabase
      .from("schedule_phases")
      .select("project_id")
      .contains("assigned_sub_ids", [subId])
      .is("created_by_sub_id", null),
    supabase
      .from("quote_requests")
      .select("project_id")
      .eq("subcontractor_id", subId)
      .in("status", [...SUB_AWARDED_QUOTE_STATUSES])
      .not("project_id", "is", null),
    supabase
      .from("subcontractor_bids")
      .select("bid_packages!inner(project_id)")
      .eq("subcontractor_id", subId)
      .eq("status", "accepted"),
    supabase
      .from("estimate_line_items")
      .select("estimates!inner(project_id, is_option)")
      .eq("awarded_subcontractor_id", subId),
    supabase.from("invoices").select("project_id").eq("subcontractor_id", subId).not("project_id", "is", null),
    supabase
      .from("project_subcontractors")
      .select("project_id")
      .eq("subcontractor_id", subId)
      .or("status.eq.active,status.is.null"),
    supabase
      .from("sub_agreements")
      .select("project_id")
      .eq("subcontractor_id", subId)
      .in("status", [...SUB_AGREEMENT_AWAITING_SIGN, "signed"]),
  ]);
  for (const r of [phases, quotes, bids, lines, invoices, projSubs, agreements]) {
    // Failing closed is right here, but say why instead of "not on your list".
    if (r.error) throw new Error(`billable jobs: ${r.error.message}`);
  }

  const ids = new Set<string>();
  const add = (pid: string | null | undefined) => pid && ids.add(pid);
  (phases.data || []).forEach((r) => add(r.project_id));
  (quotes.data || []).forEach((r) => add(r.project_id));
  (bids.data || []).forEach((r) => {
    const pkg = Array.isArray(r.bid_packages) ? r.bid_packages[0] : r.bid_packages;
    add((pkg as { project_id?: string | null } | null)?.project_id);
  });
  (lines.data || []).forEach((r) => {
    const est = Array.isArray(r.estimates) ? r.estimates[0] : r.estimates;
    const e = est as { project_id?: string | null; is_option?: boolean | null } | null;
    // An option estimate's award isn't the job's contract (same as active-jobs).
    if (e && !e.is_option) add(e.project_id);
  });
  (invoices.data || []).forEach((r) => add(r.project_id));
  (projSubs.data || []).forEach((r) => add(r.project_id));
  (agreements.data || []).forEach((r) => add(r.project_id));
  return Array.from(ids);
}
