import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callClaude } from "@/lib/ai/claude";
import crypto from "node:crypto";

export const runtime = "nodejs";

// The shape the building department actually cares about: a plain-English
// summary of the job plus the trade-by-trade breakdown an inspections office
// asks for when you pull a permit (is anything structural? plumbing?
// electrical? mechanical/gas?). NOT the contract, NOT prices — just scope.
export interface PermitScopeFields {
  summary: string;      // one-line "what is this job" for the application
  narrative: string;    // 2-4 sentence description of the work
  structural: string;   // structural work or "None"
  plumbing: string;     // plumbing work or "None"
  electrical: string;   // electrical work or "None"
  mechanical: string;   // HVAC / gas / mechanical or "None"
  site_demo: string;    // demolition / site work or "None"
}

const EMPTY = "None";

function coerce(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v).trim().slice(0, 600);
}

export async function POST(request: NextRequest) {
  try {
    // Same dual auth as the contract/proposal PDFs: a signed-in user (the
    // in-app button) or the shared service key (Penney MCP fetching a permit
    // description headlessly). Keeps this usable from the email/agent flows.
    let supabase;
    const serviceKey = request.headers.get("x-service-key");
    if (serviceKey) {
      const admin = createAdminClient();
      const { data: keyRow } = await admin
        .from("app_settings")
        .select("value")
        .eq("key", "proposal_pdf_service_key")
        .maybeSingle();
      const expected = String(keyRow?.value ?? "");
      const a = Buffer.from(serviceKey);
      const b = Buffer.from(expected);
      if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return NextResponse.json({ error: "Invalid service key" }, { status: 401 });
      }
      supabase = admin;
    } else {
      supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const projectId: string | undefined = body?.projectId;
    const town: string = coerce(body?.town, "");
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const [{ data: project }, { data: currentEstimateId }] = await Promise.all([
      supabase
        .from("projects")
        .select("name, project_number, project_type, description, scope_of_work, required_trades, address, city, state, zip")
        .eq("id", projectId)
        .single(),
      // Canonical current estimate — a status filter here returned nothing for
      // signed jobs, and permits are pulled AFTER signing.
      supabase.rpc("current_estimate_id", { p_project_id: projectId }),
    ]);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // Pull the granular scope from the current estimate — the real trade detail
    // lives in the line items, not the top-level scope_of_work blurb.
    const estimate = currentEstimateId ? { id: currentEstimateId as string } : null;
    let sections: string[] = [];
    if (estimate) {
      const { data: lines } = await supabase
        .from("estimate_line_items")
        .select("description, trade, scope_text, proposal_description, is_section_header, is_visible_on_proposal, sort_order")
        .eq("estimate_id", estimate.id)
        .order("sort_order");
      sections = (lines ?? []).map((l) => {
        if (l.is_section_header) return `## ${l.description}`;
        const scope = l.proposal_description || l.scope_text || "";
        const tradeTag = l.trade ? ` [${l.trade}]` : "";
        return `- ${l.description}${tradeTag}${scope ? ` — ${scope}` : ""}`;
      });
    }

    // required_trades is a JSON array of { trade, status } — a quick hint list.
    let tradeHints = "";
    try {
      const rt = project.required_trades;
      const arr = Array.isArray(rt) ? rt : typeof rt === "string" ? JSON.parse(rt) : [];
      const names = (arr as { trade?: string }[])
        .map((t) => t?.trade)
        .filter(Boolean);
      if (names.length) tradeHints = names.join(", ");
    } catch { /* required_trades may be malformed — ignore */ }

    const projAddress = [project.address, project.city, project.state || "MA", project.zip]
      .filter(Boolean)
      .join(", ");

    const system = `You are the estimator at Penney Construction, a residential general contractor on the North Shore of Massachusetts. Write the SCOPE OF WORK that gets submitted to a city/town building department when pulling a building permit.

The inspections office does NOT want the contract, prices, allowances, or client-facing sales language. They want a clear, factual, general description of the physical work, and specifically whether the job touches: STRUCTURAL, PLUMBING, ELECTRICAL, and MECHANICAL (HVAC/gas). Anything structural is what they care about most.

Rules:
- Plain, factual, permit-office language. No dollar amounts. No marketing.
- Be specific about what is physically being built/altered (e.g. "Remove and rebuild rear deck, 12'x16', new footings and ledger" — NOT "outdoor living space upgrade").
- For each trade field, state the actual work in a short phrase, or exactly "None" if that trade is not involved. If unsure whether a trade is touched, infer conservatively from the scope (a bathroom reno with fixtures staying in place is still plumbing; a deck rebuild is structural).
- "narrative" is 2-4 sentences a plan reviewer can read at a glance.
- "summary" is a single short line for the permit application's work-description field.
Return ONLY a JSON object, no prose, no markdown fences:
{"summary": string, "narrative": string, "structural": string, "plumbing": string, "electrical": string, "mechanical": string, "site_demo": string}`;

    const userMsg = `PROJECT: ${project.name} (${project.project_type ?? "residential"})
PROJECT #: ${project.project_number ?? "-"}
ADDRESS: ${projAddress || "(not on file)"}
${town ? `PERMITTING TOWN: ${town} (tailor emphasis to what this town's inspections office asks for)\n` : ""}DESCRIPTION: ${project.description ?? "(none)"}
SCOPE OF WORK: ${project.scope_of_work ?? "(none on file)"}
REQUIRED TRADES (hint): ${tradeHints || "(none listed)"}

ESTIMATE SECTIONS AND LINE ITEMS (the real trade detail):
${sections.join("\n") || "(no estimate lines — work only from the scope above)"}`;

    const raw = await callClaude(system, userMsg, 900);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ error: "AI returned no description" }, { status: 502 });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return NextResponse.json({ error: "AI returned malformed JSON" }, { status: 502 });
    }

    const fields: PermitScopeFields = {
      summary: coerce(parsed.summary),
      narrative: coerce(parsed.narrative),
      structural: coerce(parsed.structural, EMPTY) || EMPTY,
      plumbing: coerce(parsed.plumbing, EMPTY) || EMPTY,
      electrical: coerce(parsed.electrical, EMPTY) || EMPTY,
      mechanical: coerce(parsed.mechanical, EMPTY) || EMPTY,
      site_demo: coerce(parsed.site_demo, EMPTY) || EMPTY,
    };
    if (!fields.summary && !fields.narrative) {
      return NextResponse.json({ error: "AI returned an empty description" }, { status: 502 });
    }

    return NextResponse.json({
      fields,
      project: {
        name: project.name,
        project_number: project.project_number,
        address: projAddress,
      },
    });
  } catch (err) {
    console.error("[generate-permit-description] crashed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
