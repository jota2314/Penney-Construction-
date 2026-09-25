// Job-specific payment schedule drafting. Deliberately NOT a "use server"
// module — takes a Supabase client so the suggest route, the send-contract
// route, the contract PDF, and the signing lock all draft the same way.
//
// Jorge (9/25/26): "Read what the project is, understand it, and actually
// make the schedule of payments. All projects are different." A canned preset
// put "structure framed and weathertight" on interior jobs (Conway, Weidlein)
// because nobody replaced it before the contract went out. So a contract never
// falls back to a preset any more — the schedule is drafted from THIS job's
// scope, estimate sections and schedule phases, or the contract waits.

import { callClaude } from "@/lib/ai/claude";
import {
  FINAL_HOLDBACK_PCT,
  MA_DEPOSIT_CAP_PCT,
  PAYMENT_STAGE_OPTIONS,
} from "@/lib/constants/payment-schedule";
import type { DB } from "@/lib/contracts/contract-lock";

export interface DraftedMilestone {
  label: string;
  stage_key: string;
  percent: number;
}

/** Page 1 of the contract PDF holds six payment rows plus TOTAL; a seventh spills. */
const MAX_ROWS = 6;

export async function draftJobPaymentSchedule(
  supabase: DB,
  projectId: string,
): Promise<{ rows?: DraftedMilestone[]; total?: number; error?: string }> {
  const [{ data: project }, { data: currentEstimateId }, { data: phases }] = await Promise.all([
    supabase
      .from("projects")
      .select("name, project_type, description, scope_of_work, contract_value, estimated_value")
      .eq("id", projectId)
      .single(),
    // Canonical current estimate — a status filter here returned nothing for
    // signed jobs, exactly the jobs whose payment schedule matters.
    supabase.rpc("current_estimate_id", { p_project_id: projectId }),
    supabase
      .from("schedule_phases")
      .select("name, start_date, end_date")
      .eq("project_id", projectId)
      .order("start_date"),
  ]);
  if (!project) return { error: "Project not found" };

  const { data: estimate } = currentEstimateId
    ? await supabase
        .from("estimates")
        .select("id, total_price, version")
        .eq("id", currentEstimateId as string)
        .maybeSingle()
    : { data: null };
  let sections: string[] = [];
  if (estimate) {
    const { data: lines } = await supabase
      .from("estimate_line_items")
      .select("description, is_section_header, client_price, total_price, proposal_description")
      .eq("estimate_id", estimate.id)
      .order("sort_order");
    sections = (lines ?? []).map((l) =>
      l.is_section_header
        ? `## ${l.description}`
        : `- ${l.description} ($${Number(l.client_price ?? l.total_price ?? 0).toLocaleString("en-US")})${
            l.proposal_description ? ` — ${String(l.proposal_description).slice(0, 240)}` : ""
          }`
    );
  }
  const total =
    Number(project.contract_value ?? 0) ||
    Number(estimate?.total_price ?? 0) ||
    Number(project.estimated_value ?? 0);

  if (!project.scope_of_work && !project.description && sections.length === 0) {
    return { error: "No scope or estimate on this job to build a payment schedule from — add the scope first." };
  }

  const stageKeys = PAYMENT_STAGE_OPTIONS.map((s) => s.key).join(" | ");
  const system = `You are the senior estimator at Penney Construction, a residential general contractor in Massachusetts. You are writing the progress payment schedule for ONE specific construction contract.

Step 1 — understand the job before writing anything. Read the scope, estimate sections and schedule phases and decide what this job actually is (interior bathroom, kitchen, condo unit, basement, insulation/repair, addition, deck, porch, roof, siding, ...), what gets built, and in what order the work happens on site. Every job is different; never reuse a generic template.

Step 2 — write milestones from THAT sequence:
- Name the real work and rooms: "Kitchen cabinets installed", "Bathroom tile and plaster complete", "Ceiling removed and spray foam insulation complete". Labels are client-facing contract text: 12 words or fewer, specific, verifiable by walking the job, no internal jargon. Name the stage, don't list every task in it.
- Only use structural or envelope milestones (footings, framing, roof, "weathertight", windows set) when the scope actually includes that work. An interior job is never "framed and weathertight".
- Small, recurring draws — don't front-load. Deposit at signing about 15% (hard cap 33.3%, M.G.L. c.142A). A start-of-work / mobilization draw about 15% when the job is big enough to warrant it. Then steps of roughly 15-20% as real stages finish. No single draw bigger than about 25% unless the job is tiny.
- At most ${MAX_ROWS} rows INCLUDING the holdback, so at most ${MAX_ROWS - 1} before it. Small jobs (a few days of work) get fewer rows. On a big job, combine stages rather than exceed the limit.
- The milestone before the holdback is substantial completion (work complete, site cleaned).
- The LAST milestone is always a 10% holdback (stage_key "final_inspection") released only after final inspection passes and the punch list is complete. Exactly 10.
- "percent" is the percentage SHARE of the contract (25 means 25%); percentages sum to exactly 100, one decimal max.

Return ONLY a JSON array, no prose, no markdown fences: [{"label": string, "stage_key": one of ${stageKeys}, "percent": number}]`;

  const userMsg = `PROJECT: ${project.name} (${project.project_type ?? "residential"})
CONTRACT PRICE: $${total.toLocaleString("en-US")}
DESCRIPTION: ${project.description ?? "(none)"}
SCOPE OF WORK: ${project.scope_of_work ?? "(none on file)"}

ESTIMATE SECTIONS AND LINES:
${sections.join("\n") || "(no estimate lines)"}

PROJECT SCHEDULE PHASES:
${(phases ?? []).map((p) => `- ${p.name}: ${p.start_date} to ${p.end_date}`).join("\n") || "(no schedule set yet)"}`;

  // One retry with the specific complaint when the first answer breaks the
  // row budget or drops the holdback; never silently truncate, which is how a
  // substantial-completion row once got relabeled as the holdback.
  let rows: DraftedMilestone[] | null = null;
  let complaint = "";
  for (let attempt = 0; attempt < 2 && !rows; attempt++) {
    const raw = await callClaude(system, complaint ? `${userMsg}

YOUR LAST ANSWER WAS REJECTED: ${complaint} Fix it.` : userMsg, 1200);
    const parsed = parseRows(raw);
    if (typeof parsed === "string") complaint = parsed;
    else rows = parsed;
  }
  if (!rows) return { error: complaint || "AI returned an unusable schedule" };

  // Order matters here. The holdback is pinned FIRST and the remaining
  // milestones renormalized to 90%, and only then is the deposit capped —
  // capping against 100 and rescaling afterwards would push the deposit back
  // over the MA 1/3 limit.
  let vals = rows.map((r) => Number(r.percent));
  const last = vals.length - 1;

  const headSum = vals.slice(0, last).reduce((s, v) => s + v, 0);
  if (!(headSum > 0)) return { error: "AI returned an unusable schedule" };
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
  if (vals.some((v) => v <= 0)) return { error: "AI returned an unusable schedule" };

  return { rows: rows.map((r, i) => ({ ...r, percent: vals[i] })), total };
}

/** Parse and structurally validate one AI answer; a string return is the reason it was rejected. */
function parseRows(raw: string): DraftedMilestone[] | string {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return "No JSON array was returned.";
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return "The JSON was malformed.";
  }
  const validKeys = new Set<string>(PAYMENT_STAGE_OPTIONS.map((s) => s.key));
  const rows = (Array.isArray(parsed) ? parsed : [])
    .filter((r) => r && typeof r.label === "string" && r.label.trim() && Number(r.percent) > 0)
    .map((r) => ({
      label: String(r.label).trim().slice(0, 200),
      stage_key: validKeys.has(r.stage_key) ? String(r.stage_key) : "custom",
      percent: Math.round(Number(r.percent) * 10) / 10,
    }));
  if (rows.length < 3) return "Fewer than 3 usable milestones.";
  if (rows.length > MAX_ROWS) return `${rows.length} rows; the limit is ${MAX_ROWS} including the holdback.`;
  if (rows[rows.length - 1].stage_key !== "final_inspection") {
    return 'The last row must be the 10% holdback with stage_key "final_inspection".';
  }
  if (rows.slice(0, -1).some((r) => r.stage_key === "final_inspection")) {
    return "Only the last row may be the holdback.";
  }
  return rows;
}
