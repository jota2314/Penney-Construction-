import { NextRequest, NextResponse, after } from "next/server";
import { resolveSubAccessResult } from "@/lib/sub-portal/access";
import { refuseStaffBrowser } from "@/lib/sub-portal/staff-guard";
import { loadSubHome } from "@/lib/sub-portal/load-sub-portal-data";

export const runtime = "nodejs";

// A "visit" is a GET at least this long after the last one, so a phone that
// refetches on every wake (and dev strict mode's double fetch) counts once.
const VIEW_GAP_MS = 30 * 60 * 1000;

/**
 * GET /api/sub-portal → SubHomePayload (src/lib/sub-portal/payload.ts).
 *
 * The signed-in sub's Today, Dates, Money and Needed, resolved from the login
 * cookie. Light on purpose: posts and photos load per job from
 * /api/sub-portal/job/[id]. Everything is scoped to his company by the
 * loader: no client pricing, no other subs' numbers.
 */
export async function GET(request: NextRequest) {
  const staff = await refuseStaffBrowser(request);
  if (staff) return staff;

  const resolved = await resolveSubAccessResult(request);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { supabase, subId, accessId, lastViewedAt, viewCount } = resolved.access;

  const data = await loadSubHome({ subId, accessId, mode: "sub", supabase });
  if (!data) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Count a real visit at most once per 30 minutes. The WHERE re-checks the
  // gap, so two GETs at once can't both bump it.
  const lastMs = lastViewedAt ? new Date(lastViewedAt).getTime() : 0;
  if (!lastViewedAt || Number.isNaN(lastMs) || Date.now() - lastMs > VIEW_GAP_MS) {
    const cutoff = new Date(Date.now() - VIEW_GAP_MS).toISOString();
    after(async () => {
      const { error } = await supabase
        .from("sub_portal_access")
        .update({ last_viewed_at: new Date().toISOString(), view_count: viewCount + 1 })
        .eq("id", accessId)
        .or(`last_viewed_at.is.null,last_viewed_at.lt."${cutoff}"`);
      if (error) console.error("[sub-portal] view count update failed", error.message);
    });
  }

  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
