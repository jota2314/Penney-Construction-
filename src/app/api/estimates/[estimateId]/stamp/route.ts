/**
 * GET /api/estimates/[estimateId]/stamp
 *
 * Cheap change-detection for the Live Proposal view. Returns
 * { stamp, total_price, total_cost, margin_pct, line_count, updated_at };
 * the stamp changes whenever the estimate, any of its lines (insert, update
 * or delete), its project or its customer changes. The page polls this every
 * few seconds and reloads the proposal PDF only when the stamp moves.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProposalStamp } from "@/lib/estimates/proposal-stamp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ estimateId: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401, headers: NO_STORE });
    }

    const { estimateId } = await params;
    const result = await getProposalStamp(supabase, estimateId);
    if (!result) {
      return NextResponse.json({ error: "Estimate not found" }, { status: 404, headers: NO_STORE });
    }

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    console.error("[estimates/stamp] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read estimate stamp" },
      { status: 500, headers: NO_STORE },
    );
  }
}
