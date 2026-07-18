import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/ai/claude";
import { PAYMENT_STAGE_OPTIONS } from "@/lib/constants/payment-schedule";

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
- 3 to 6 milestones. The first is always the deposit due at signing.
- Massachusetts law (M.G.L. c.142A): the deposit must NOT exceed 33.3% of the contract price.
- Percentages sum to exactly 100. One decimal max; put any rounding on the final milestone.
- Tie every milestone to a verifiable point in THIS job's build sequence, using the estimate sections and schedule phases provided. Match cash flow to when the matching costs land (big framing/material cost => draw at frame/weathertight, etc.).
- The final milestone is always substantial completion / final inspection and should be meaningful (at least 10%).
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
    if (rows.length < 2) return NextResponse.json({ error: "AI returned an unusable schedule" }, { status: 502 });

    if (rows[0].percent > 33.3) rows[0].percent = 33.3;
    const sumButLast = rows.slice(0, -1).reduce((s, r) => s + r.percent, 0);
    rows[rows.length - 1].percent = Math.round((100 - sumButLast) * 10) / 10;
    if (rows[rows.length - 1].percent <= 0) {
      return NextResponse.json({ error: "AI schedule percentages were invalid" }, { status: 502 });
    }

    return NextResponse.json({ rows, total });
  } catch (err) {
    console.error("[suggest-payment-schedule] crashed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
