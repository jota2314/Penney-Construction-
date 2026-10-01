import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { draftJobPaymentSchedule } from "@/lib/contracts/job-payment-schedule";

export const runtime = "nodejs";

// AI-drafted payment schedule: reads THIS job's scope, estimate sections, and
// schedule phases, and proposes milestones tied to verifiable build stages.
// The user reviews the rows in the Payment Schedule block before anything is
// invoiced — AI suggests, the user stays in the driver's seat.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { projectId } = await request.json();
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const draft = await draftJobPaymentSchedule(supabase, projectId);
    if (draft.error || !draft.rows) {
      const status = draft.error === "Project not found" ? 404 : 502;
      return NextResponse.json({ error: draft.error ?? "AI returned no schedule" }, { status });
    }
    return NextResponse.json({ rows: draft.rows, total: draft.total });
  } catch (err) {
    console.error("[suggest-payment-schedule] crashed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
