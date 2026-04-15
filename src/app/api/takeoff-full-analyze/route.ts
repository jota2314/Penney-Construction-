import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS, nowStamp, logAiUsage } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/takeoff-full-analyze
 *
 * Phase 1 rewrite: returns a source-cited quantities table instead of a narrative.
 *
 * EVERY quantity must trace back to a literal string on a drawing:
 *   - A dimension (e.g., "24'-6\"")
 *   - A schedule row (e.g., window schedule row W1)
 *   - A callout (e.g., "5.25x14 LVL")
 *   - Or a computed value from explicit dims (with the math shown)
 *
 * Things that are not explicitly on the drawings go into `missingInfo`, NOT
 * fabricated into `quantities`. Confidence defaults to "low" unless the
 * source is a verbatim dim string or schedule row.
 *
 * Response schema:
 * {
 *   projectSummary: { type, stories, totalFootprint, notes },
 *   sheetIndex: [ { page, sheetNumber, title, purpose } ],
 *   quantities: [ {
 *     id, category, item, quantity, unit,
 *     sourceSheet, sourceType, sourceDetail, computation, confidence, notes
 *   } ],
 *   schedules: { windows[], doors[], structural[], finishes[] },
 *   missingInfo: [ { item, whyNeeded, suggestedSource } ],
 *   materialNotes: [ string ],
 *   model
 * }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { pages, filename, drawingText, scopeOfWork, projectId } = await request.json();

  if (!Array.isArray(pages) || pages.length === 0) {
    return NextResponse.json({ error: "No drawing pages provided" }, { status: 400 });
  }

  let projectInfo = "";
  if (projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("name, address, project_type, scope_of_work, required_trades")
      .eq("id", projectId)
      .single();
    if (project) {
      projectInfo = `\nProject: ${project.name}\nAddress: ${project.address || "N/A"}\nType: ${project.project_type || "residential"}\n${project.scope_of_work ? `Known scope: ${project.scope_of_work}` : ""}`;
    }
  }

  const { data: tradeRates } = await supabase
    .from("trade_rates")
    .select("trade_name, unit_type")
    .eq("is_active", true)
    .limit(50);
  const tradeList = tradeRates?.map(r => r.trade_name).join(", ") || "";

  const systemPrompt = `You are a senior residential construction estimator and plan reader for a GC on the North Shore of Massachusetts. Current date: ${nowStamp()}.

You are analyzing a complete ${pages.length}-page drawing set. Your job is to produce a SOURCE-CITED QUANTITIES TABLE that a human estimator can verify line-by-line and pass to vendors for pricing.

${projectInfo}
${scopeOfWork ? `\nScope context: ${scopeOfWork}` : ""}
${drawingText ? `\nText extracted from PDF:\n${drawingText.substring(0, 4000)}` : ""}
${tradeList ? `\nKnown trades: ${tradeList}` : ""}
Drawing filename: ${filename || "Unknown"}

===================================================================
THE CORE RULE: EVERY NUMBER MUST BE TRACEABLE — AND YOU MUST BE THOROUGH.
===================================================================
For every quantity you output, you MUST be able to point at the literal
string on the drawing that gave it to you. If you can't, it goes in
\`missingInfo\`, NOT in \`quantities\`.

Allowed sources (sourceType):
  - "dimension_string": you read a dim like "24'-6\\"" printed on the plan
  - "schedule_row": you copied a row from a window/door/structural schedule
  - "callout": you read a structural callout like "5.25x14 LVL" or "W8x28"
  - "computed": you computed from multiple labeled dims (MUST show the math in \`computation\`)

Never acceptable:
  - Guessing a square footage because "the room looks like ~200 sqft"
  - Estimating a wall length by eyeballing the plan
  - Inferring a floor count, story count, or room count from absence of evidence
  - Inventing a window/door count not shown in a schedule or counted on elevations

THOROUGHNESS MANDATE — this is as important as the traceability rule.
A typical residential addition permit set should yield **20-50 quantity
rows**, not 3. Sheets you receive have been chosen because they contain
information. If you return very few rows, you are under-extracting — go
back through EACH sheet and ask:
  - What exterior dimensions are labeled? (foundation LF, footprint)
  - What room dimensions are labeled? (floor SF by room)
  - What is on the window schedule? (one row per window tag)
  - What is on the door schedule? (one row per door tag)
  - What LVL / PSL / steel beam callouts are on structural sheets?
  - What header sizes / joist sizes are called out in framing plans?
  - What roof pitch / roof footprint / overhang dims are on elevations?
  - What wall / floor assemblies are noted in general notes?
  - What finish schedule rooms are listed?

Confidence calibration:
  - "high" = verbatim from dim, callout, or schedule row
  - "medium" = straightforward computation from labeled dims
  - "low" = computation involved assumptions (e.g., 9' wall height not labeled)

It is FINE to output medium/low confidence rows — the user will verify
them. DO NOT drop a quantity just because confidence isn't high. Under-
extraction is worse than a low-confidence row with a clear citation.

===================================================================
PROJECT SUMMARY — must itself be source-cited
===================================================================
- stories: only claim "1" if you see exactly one floor plan, "2" if you see two distinct floor plans OR an elevation showing two floor levels. Otherwise "unknown".
- type: "addition" | "remodel" | "new_construction" | "unknown". Only claim if the cover sheet, demolition notes, or scope notes say so literally.
- totalFootprint: only fill if a sheet literally states total heated SF or you can compute it from labeled exterior dimensions.

===================================================================
SCHEDULES — MANDATORY: find and enumerate every schedule in the set
===================================================================
Residential permit sets ALMOST ALWAYS contain:
  - Window schedule (usually on floor plan sheet, e.g., A101)
  - Door schedule (same sheet or next sheet)
  - Structural member schedule or callouts (on S0.0, S1.0 framing plans)
  - Sometimes a finish schedule (on A101 or separate sheet)

Your job: FIND these schedules and transcribe every row. If the sheet
shows a window schedule with 8 rows, output 8 window objects. If
framing plans have LVL callouts like "5.25x14 LVL" labeled on beams,
output one structural object per distinct member.

DO NOT summarize. DO NOT output "5 windows per window schedule" — output
each individual row with its tag, size, and count.

If you scan a sheet and believe it SHOULD have a schedule but you can't
read it clearly, note that in \`missingInfo\` — do not silently skip.

Schema per type:
  Windows: { tag, manufacturer, model, size (as shown: "3040", "2856"), count (from QTY column, default 1 if no qty column), sourceSheet }
  Doors: { tag, type (exterior/interior/pocket/bi-fold), size, count, sourceSheet }
  Structural: { tag (B1, H1, etc. — or null if callout only), type ("LVL", "PSL", "STL", "RIDGE", "HEADER"), size ("5.25x14", "W8x28"), span, count, sourceSheet }
  Finishes: { room, floor, walls, ceiling, sourceSheet }

===================================================================
QUANTITIES — one row per item, category-grouped
===================================================================
Categories: foundation, framing, roofing, windows, doors, siding, insulation,
drywall, flooring, electrical, plumbing, hvac, site, demolition, other.

Every quantity MUST have a concrete countable unit (LF, SF, sqft, ea, count,
cuft, LB, sheets) AND a concrete number. NEVER "1 lot" for something like
"foundation details exist" or "connection details shown on S2.0". Those are
not takeoff rows — they're sheet contents, and the user doesn't need them.

Examples of GOOD rows:
  {
    "id": "q1", "category": "foundation", "item": "Foundation perimeter",
    "quantity": 129, "unit": "LF",
    "sourceSheet": "A101", "sourceType": "computed",
    "sourceDetail": "Labeled exterior dims on foundation plan: 24'-6\\" + 40'-0\\" + 24'-6\\" + 40'-0\\"",
    "computation": "24.5 + 40 + 24.5 + 40 = 129",
    "confidence": "high",
    "notes": "10\\" poured concrete wall per foundation note"
  }
  {
    "id": "q2", "category": "framing", "item": "LVL beam - 5.25x14 @ 18' span",
    "quantity": 1, "unit": "ea",
    "sourceSheet": "S1.0", "sourceType": "callout",
    "sourceDetail": "Beam legend row: 5.25x14 LVL, 18'-0\\" span, B1",
    "confidence": "high"
  }
  {
    "id": "q3", "category": "framing", "item": "Floor joists - 2x10 x 16' @ 16\\" OC",
    "quantity": 24, "unit": "ea",
    "sourceSheet": "S1.0", "sourceType": "computed",
    "sourceDetail": "Joist span 32' labeled on S1.0, 2x10 @ 16\\" OC per legend",
    "computation": "32' / (16\\"/12) = 24 joists",
    "confidence": "medium"
  }

Examples of BAD rows — DO NOT OUTPUT ANY OF THESE:
  { "item": "Foundation wall details", "quantity": 1, "unit": "lot" }
  -> NO. This just says a detail sheet exists. Not a takeoff item. Drop it.

  { "item": "Steel beam connection details", "quantity": 1, "unit": "lot" }
  -> NO. Same reason. Details are not takeoff items.

  { "item": "Engineered beam", "quantity": 1, "unit": "ea" }
  -> NO. Too vague. Must be a specific member: "LVL 5.25x14 @ 18' span, 1 ea."
     Transcribe EACH distinct member from the beam legend or schedule.

  { "item": "Floor joists - 2x10 @ 16\\" OC", "quantity": 1, "unit": "lot" }
  -> NO. "1 lot" for joists is useless for pricing. Compute actual count:
     count = framed_span_LF / (OC_spacing_in / 12). If you don't have
     labeled span, put in missingInfo — do not output "1 lot".

  { "item": "Foundation perimeter", "quantity": 72, "unit": "LF",
    "computation": "18+18+18+18 (estimated from plan grid)" }
  -> NO. "Estimated from plan grid" is a guess, not a citation. Either read
     the actual labeled dims on the foundation plan or put in missingInfo.

  { "item": "Stud count", "quantity": 240,
    "computation": "approximately 240 studs based on typical wall layout" }
  -> NO. Either compute from labeled wall lengths OR put in missingInfo.

  { "item": "Siding SF", "quantity": 1800 }
  -> NO. Where did 1800 come from? If elevations have labeled wall heights
     and widths, cite them and show the math. If not, missingInfo.

Confidence calibration:
  - "high": verbatim from a printed dim, callout, or schedule row
  - "medium": computed from 2-3 labeled dims with straightforward math
  - "low": you read it but it's partially legible, or the computation involves assumptions (e.g., typical 9' wall height when height isn't labeled)

UNIT RULES:
  - Allowed units: LF, SF, sqft, ea, count, cuft, sheets, LB, tons
  - BANNED: "lot" unless it is literally a contract lump sum amount
  - If you can't express the item in a real unit with a real number, drop
    the row or put the item in missingInfo

===================================================================
MISSING INFO — the honest list
===================================================================
Anything a GC would need to price the job that IS NOT EXPLICITLY ON THE
DRAWINGS goes here. Examples:
  - "Roof pitch" / "Check elevations A201"
  - "Foundation height" / "Not dimensioned; need field measurement"
  - "Insulation R-value" / "Check general notes on cover sheet"
  - "Window manufacturer" / "Schedule shows sizes but no manufacturer"

Do NOT populate missingInfo with things trivially visible. Only things truly
missing or ambiguous.

===================================================================
OUTPUT FORMAT — valid JSON only, no markdown fences
===================================================================
{
  "projectSummary": {
    "type": "addition" | "remodel" | "new_construction" | "unknown",
    "stories": 1 | 2 | 3 | "unknown",
    "totalFootprint": { "value": 450, "unit": "sqft", "sourceSheet": "A001" } | null,
    "notes": "Short sentence, source-grounded"
  },
  "sheetIndex": [
    { "page": 1, "sheetNumber": "A001", "title": "Cover Sheet", "purpose": "general notes, locus, drawing index" }
  ],
  "quantities": [
    { "id": "q1", "category": "foundation", "item": "...", "quantity": 129, "unit": "LF",
      "sourceSheet": "A101", "sourceType": "computed",
      "sourceDetail": "exterior dim strings", "computation": "24.5+40+24.5+40=129",
      "confidence": "high", "notes": "..." }
  ],
  "schedules": {
    "windows": [ { "tag": "W1", "manufacturer": "...", "model": "...", "size": "3040", "count": 4, "sourceSheet": "A201" } ],
    "doors": [ ... ],
    "structural": [ ... ],
    "finishes": [ ... ]
  },
  "missingInfo": [
    { "item": "Roof pitch", "whyNeeded": "required to compute roof SF from footprint", "suggestedSource": "check elevation sheets" }
  ],
  "materialNotes": [ "Exterior siding: pre-stained white cedar shingle per cover sheet note 3" ]
}

BE HONEST. Short and accurate beats long and wrong. The human estimator will verify every row against the sheet you cite — if you lie they will see it.`;

  try {
    const anthropic = await getAnthropicClient();

    type MediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

    const content: Array<
      | { type: "image"; source: { type: "base64"; media_type: MediaType; data: string } }
      | { type: "text"; text: string }
    > = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const mt = (page.mediaType || "image/png") as MediaType;
      content.push({
        type: "image",
        source: { type: "base64", media_type: mt, data: page.data },
      });
      content.push({
        type: "text",
        text: `[Page ${i + 1} of ${pages.length}${page.label ? `: ${page.label}` : ""}]`,
      });
    }

    content.push({
      type: "text",
      text: `Produce the source-cited quantities table for this drawing set. Every quantity row must cite a sheet and the exact source text (dim string, schedule row, or callout) that gave you the number. If you cannot cite, put the item in missingInfo instead. Respond with valid JSON matching the schema. No markdown fences.`,
    });

    let responseText = "";
    let usedModel = "";

    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: 16000,
          system: systemPrompt,
          messages: [{ role: "user", content }],
        });
        usedModel = model;
        if (response.usage) {
          logAiUsage({
            userId: user.id,
            endpoint: "takeoff-full-analyze",
            model,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            context: `${pages.length} pages, ${filename}`,
          });
        }
        responseText = response.content[0]?.type === "text" ? response.content[0].text : "";
        if (responseText) break;
      } catch (err) {
        console.error(`takeoff-full-analyze ${model} error:`, err);
        continue;
      }
    }

    if (!responseText) {
      return NextResponse.json({ error: "AI analysis failed" }, { status: 500 });
    }

    try {
      let jsonStr = responseText;
      const s = jsonStr.indexOf("{");
      const e = jsonStr.lastIndexOf("}");
      if (s !== -1 && e > s) jsonStr = jsonStr.substring(s, e + 1);

      const result = JSON.parse(jsonStr);

      // Server-side quality filter: strip rows that are obviously not takeoff
      // items, regardless of what Claude returned.
      if (Array.isArray(result.quantities)) {
        const existenceWords = /^(details|connection details|notes|legend|typical|general|sheet)\b/i;
        result.quantities = result.quantities.filter((q: {
          quantity?: number; unit?: string; item?: string; computation?: string;
        }) => {
          const unit = String(q.unit || "").toLowerCase().trim();
          const item = String(q.item || "").trim();
          const comp = String(q.computation || "").toLowerCase();
          // Drop: lot unit (almost never useful for takeoff)
          if (unit === "lot") return false;
          // Drop: quantity <= 0 (no real number)
          if (!q.quantity || Number(q.quantity) <= 0) return false;
          // Drop: existence-confirmation items
          if (existenceWords.test(item)) return false;
          // Drop: computation that admits it's a guess
          if (/(estimated from plan grid|approximately|based on typical|rough estimate)/i.test(comp)) return false;
          return true;
        });
      }

      return NextResponse.json({ ...result, model: usedModel });
    } catch {
      return NextResponse.json({
        error: "AI returned non-JSON response",
        raw: responseText.substring(0, 2000),
      }, { status: 500 });
    }
  } catch (err) {
    console.error("takeoff-full-analyze error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed" },
      { status: 500 }
    );
  }
}
