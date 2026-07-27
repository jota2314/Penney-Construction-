import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/ai/claude";
import {
  FINAL_HOLDBACK_PCT,
  MA_DEPOSIT_CAP_PCT,
  PAYMENT_STAGE_OPTIONS,
} from "@/lib/constants/payment-schedule";

export const runtime = "nodejs";

// AI-drafted payment schedule: reads THIS job's scope, estimate sections, and
// schedule phases, and proposes milestones tied to verifiable build stages
// (footings poured, rough inspection passed, ...). The user reviews the rows
// in the Payment Schedule block before anything is invoiced — AI suggests,
// the user stays in the driver's seat.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { projectId } = await request.json();
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const [{ data: project }, { data: estimates }, { data: phases }] = await Promise.all([
      supabase
        .from("projects")
        .select("name, project_type, scope_of_work, contract_value, estimated_value")
        .eq("id", projectId)
        .single(),
      supabase
        .from("estimates")
        .select("id, total_price, version")
        .eq("project_id", projectId)
        .in("status", ["approved", "draft"])
        .order("version", { ascending: false })
        .limit(1),
      supabase
        .from("schedule_phases")
        .select("name, start_date, end_date")
        .eq("project_id", projectId)
        .order("start_date"),
    ]);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const estimate = estimates?.[0];
    let sections: string[] = [];
    if (estimate) {
      const { data: lines } = await supabase
        .from("estimate_line_items")
        .select("description, is_section_header, client_price, total_price")
        .eq("estimate_id", estimate.id)
        .order("sort_order");
      sections = (lines ?? []).map((l) =>
        l.is_section_header
          ? `## ${l.description}`
          : `- ${l.description} ($${Number(l.client_price ?? l.total_price ?? 0).toLocaleString("en-US")})`
      );
    }
    const total =
      Number(project.contract_value ?? 0) ||
      Number(estimate?.total_price ?? 0) ||
      Number(project.estimated_value ?? 0);

    const stageKeys = PAYMENT_STAGE_OPTIONS.map((s) => s.key).join(" | ");
    const system = `You are the senior estimator at Penney Construction, a residential general contractor in Massachusetts. Design the progress payment schedule for a construction contract. Hard rules:
- 4 to 6 milestones. The first is always the deposit due at signing.
- Massachusetts law (M.G.L. c.142A): the deposit must NOT exceed 33.3% of the contract price.
- "percent" is the percentage SHARE of the contract (e.g. 25 means 25%) — never a dollar amount, never a fraction like 0.25.
- Percentages sum to exactly 100. One decimal max; put any rounding on the substantial-completion milestone, never on the holdback.
- Tie every milestone to a verifiable point in THIS job's build sequence, using the estimate sections and schedule phases provided. Match cash flow to when the matching costs land (big framing/material cost => draw at frame/weathertight, etc.).
- The LAST milestone is always a 10% holdback (stage_key "final_inspection") released only after the final inspection passes and the punch list is complete. Exactly 10, never more, never less — this is a retainer, not a draw. Label it so the client can see it is a holdback.
- The milestone BEFORE the holdback is substantial completion (work complete, site cleaned).
- Labels are client-facing contract text: short, specific to this job, no internal jargon.
Return ONLY a JSON array, no prose, no markdown fences: [{"label": string, "stage_key": one of ${stageKeys}, "percent": number}]`;

    const userMsg = `PROJECT: ${project.name} (${project.project_type ?? "residential"})
CONTRACT PRICE: $${total.toLocaleString("en-US")}
SCOPE OF WORK: ${project.scope_of_work ?? "(none on file)"}

ESTIMATE SECTIONS AND LINES:
${sections.join("\n") || "(no estimate lines)"}

PROJECT SCHEDULE PHASES:
${(phases ?? []).map((p) => `- ${p.name}: ${p.start_date} to ${p.end_date}`).join("\n") || "(no schedule set yet)"}`;

    const raw = await callClaude(system, userMsg, 1200);
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return NextResponse.json({ error: "AI returned no schedule" }, { status: 502 });

    let rows: { label: string; stage_key: string; percent: number }[];
    try {
      rows = JSON.parse(match[0]);
    } catch {
      return NextResponse.json({ error: "AI returned malformed JSON" }, { status: 502 });
    }

    // Validate + normalize so a wobbly AI answer can never produce an
    // out-of-compliance or non-summing schedule.
    const validKeys = new Set<string>(PAYMENT_STAGE_OPTIONS.map((s) => s.key));
    rows = (Array.isArray(rows) ? rows : [])
      .filter((r) => r && typeof r.label === "string" && r.label.trim() && Number(r.percent) > 0)
      .slice(0, 6)
      .map((r) => ({
        label: r.label.trim().slice(0, 200),
        stage_key: validKeys.has(r.stage_key) ? r.stage_key : "custom",
        percent: Math.round(Number(r.percent) * 10) / 10,
      }));
    if (rows.length < 3) return NextResponse.json({ error: "AI returned an unusable schedule" }, { status: 502 });

    // Order matters here. The holdback is pinned FIRST and the remaining
    // milestones renormalized to 90%, and only then is the deposit capped —
    // capping against 100 and rescaling afterwards would push the deposit back
    // over the MA 1/3 limit.
    let vals = rows.map((r) => Number(r.percent));
    const last = vals.length - 1;

    // Renormalize milestones 0..last-1 to 90%, whatever scale came back
    // (percentages, fractions, weights, even dollar amounts).
    const headSum = vals.slice(0, last).reduce((s, v) => s + v, 0);
    if (!(headSum > 0)) return NextResponse.json({ error: "AI returned an unusable schedule" }, { status: 502 });
    const HEAD_TOTAL = 100 - FINAL_HOLDBACK_PCT;
    for (let i = 0; i < last; i++) vals[i] = (vals[i] / headSum) * HEAD_TOTAL;
    vals[last] = FINAL_HOLDBACK_PCT;

    // Cap the deposit at the MA 1/3 limit, handing the excess to the other
    // pre-holdback milestones proportionally. The holdback never absorbs it.
    if (vals[0] > MA_DEPOSIT_CAP_PCT - 0.04) {
      const capped = MA_DEPOSIT_CAP_PCT - 0.04; // 33.3
      const excess = vals[0] - capped;
      vals[0] = capped;
      const midSum = vals.slice(1, last).reduce((s, v) => s + v, 0);
      for (let i = 1; i < last; i++) {
        vals[i] += midSum > 0 ? (excess * vals[i]) / midSum : excess / Math.max(1, last - 1);
      }
    }

    // One decimal, absorb rounding drift on the milestone before the holdback.
    vals = vals.map((v) => Math.round(v * 10) / 10);
    const drift = Math.round((100 - vals.reduce((s, v) => s + v, 0)) * 10) / 10;
    vals[last - 1] = Math.round((vals[last - 1] + drift) * 10) / 10;
    if (vals.some((v) => v <= 0)) {
      return NextResponse.json({ error: "AI returned an unusable schedule" }, { status: 502 });
    }
    rows = rows.map((r, i) => ({ ...r, percent: vals[i] }));

    return NextResponse.json({ rows, total });
  } catch (err) {
    console.error("[suggest-payment-schedule] crashed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
