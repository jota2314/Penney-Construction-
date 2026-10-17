import { NextRequest, NextResponse } from "next/server";
import { resolveSubAccessResult } from "@/lib/sub-portal/access";
import { refuseStaffBrowser } from "@/lib/sub-portal/staff-guard";
import { loadSubJob } from "@/lib/sub-portal/load-sub-portal-data";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/sub-portal/job/{projectId}[?cursor=] → SubJobPayload.
 *
 * One job as the signed-in sub sees it, loaded when he opens it: his
 * company's posts 20 at a time (pass next_cursor back as ?cursor= for the
 * next page), drawings through the crew file filter, his scope, every
 * inspection, selections, his dates, quotes, billing and agreements.
 * 404 when it isn't one of his jobs. Doesn't count as a portal visit.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await refuseStaffBrowser(request);
  if (staff) return staff;

  const resolved = await resolveSubAccessResult(request);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { supabase, subId } = resolved.access;

  const { id } = await params;
  const result = await loadSubJob({
    subId,
    projectId: id,
    mode: "sub",
    cursor: request.nextUrl.searchParams.get("cursor"),
    supabase,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
