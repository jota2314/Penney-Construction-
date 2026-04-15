import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS, nowStamp, logAiUsage } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/takeoff-full-analyze
 *
 * Receives base64 images of ALL drawing pages + optional text.
 * Sends them to Claude vision to:
 *   1. Understand the full scope of work
 *   2. Extract every dimension / quantity it can read
 *   3. Generate a takeoff checklist with pre-filled quantities
 *   4. Flag what needs manual measurement
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { pages, filename, drawingText, scopeOfWork, projectId } = await request.json();

  if (!Array.isArray(pages) || pages.length === 0) {
    return NextResponse.json({ error: "No drawing pages provided" }, { status: 400 });
  }

  // Fetch project info if available
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

  // Fetch trade rates for context
  const { data: tradeRates } = await supabase
    .from("trade_rates")
    .select("trade_name, unit_type")
    .eq("is_active", true)
    .limit(50);

  const tradeList = tradeRates?.map(r => r.trade_name).join(", ") || "";

  const systemPrompt = `You are a senior residential construction estimator and plan reader for a GC on the North Shore of Massachusetts. Current date: ${nowStamp()}.

You are analyzing a complete set of architectural/construction drawings (${pages.length} page${pages.length > 1 ? "s" : ""}). Your job is to:

1. **Read every page carefully** — cover sheets, floor plans, elevations, sections, details, structural, notes
2. **Understand the full scope of work** — what is being built/renovated
3. **Extract EVERY dimension and quantity you can read** from the drawings:
   - Room dimensions, wall lengths, ceiling heights
   - Window/door sizes and counts from schedules
   - Roof pitches, overhang dimensions
   - Setbacks, lot dimensions
   - Material specifications noted on drawings
   - Square footages noted or calculable from dimensions
4. **Generate a comprehensive takeoff checklist** with quantities pre-filled where possible
5. **Flag what needs manual measurement** (things you can see but can't read exact dimensions for)

${projectInfo}
${scopeOfWork ? `\nScope context: ${scopeOfWork}` : ""}
${drawingText ? `\nExtracted text from PDF:\n${drawingText.substring(0, 4000)}` : ""}
${tradeList ? `\nKnown trades: ${tradeList}` : ""}

Drawing filename: ${filename || "Unknown"}

RESPOND WITH VALID JSON ONLY (no markdown fences):
{
  "scopeOfWork": "Detailed description of what the project involves based on the drawings. Be specific about rooms, areas, and work types.",
  "drawingIndex": [
    { "page": 1, "title": "Cover Sheet", "description": "General notes, drawing index, locus map" }
  ],
  "extractedDimensions": [
    {
      "label": "What this dimension is (e.g., 'Living Room Width', 'Garage Door Opening')",
      "value": 12.5,
      "unit": "ft",
      "type": "linear",
      "source": "Which page/drawing this was read from",
      "confidence": "high"
    }
  ],
  "takeoffItems": [
    {
      "label": "Specific item name (e.g., 'First Floor Addition - Framing')",
      "type": "linear" | "area" | "count",
      "trade": "trade category",
      "description": "What to measure and where on the drawing",
      "extractedValue": 450.5,
      "extractedUnit": "sqft",
      "needsManualMeasurement": false,
      "confidence": "high",
      "page": 3
    }
  ],
  "materialNotes": [
    "Any material specifications or notes read from the drawings"
  ],
  "scaleInfo": {
    "detected": true,
    "description": "What scale reference was found (e.g., '1/4 inch = 1 foot on sheet A101')",
    "suggestedReference": "A known dimension to use for calibration (e.g., 'The 3-foot door on sheet A101')"
  }
}

Rules:
- extractedValue should ONLY be set when you can clearly read or calculate the dimension from the drawings
- Set needsManualMeasurement=true when you can see something needs measuring but can't read the exact value
- confidence: "high" = clearly readable dimension, "medium" = calculated from other dims, "low" = estimated
- Include 15-30 takeoff items covering ALL trades visible in the drawings
- Order takeoff items by trade, then by page
- For areas, calculate from room dimensions when possible (e.g., 12ft x 15ft = 180 sqft)
- Include counts for windows, doors, outlets, fixtures visible in schedules or drawings
- Be specific to THIS project — don't generate generic items

ANTI-HALLUCINATION RULES (very important):
- NEVER invent floor counts, stories, or scope items you cannot literally see.
  - "Two-story" requires you to see TWO distinct floor plans OR an elevation showing two floor levels. If you only see one floor plan, call it a one-story project.
  - If you are unsure of floor count, write the scopeOfWork without claiming a number ("Addition to existing residence — floor count unclear from submitted sheets").
- NEVER invent rooms, square footages, or trades that are not shown on the drawings.
- For every major claim in scopeOfWork (number of floors, addition size, rooms added), the drawingIndex entry or takeoffItem must point at the exact sheet where you saw it. If you can't cite a source sheet, drop the claim.
- When in doubt, be shorter and more honest rather than long and wrong.`;

  try {
    const anthropic = await getAnthropicClient();

    type MediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

    // Build the message content with all page images
    const content: Array<
      | { type: "image"; source: { type: "base64"; media_type: MediaType; data: string } }
      | { type: "text"; text: string }
    > = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const mt = (page.mediaType || "image/png") as MediaType;
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mt,
          data: page.data, // base64 string (no data: prefix)
        },
      });
      content.push({
        type: "text",
        text: `[Page ${i + 1} of ${pages.length}${page.label ? `: ${page.label}` : ""}]`,
      });
    }

    content.push({
      type: "text",
      text: "Analyze ALL pages above. Extract every dimension, quantity, and specification you can read. Generate a complete takeoff checklist. Respond with JSON only.",
    });

    let responseText = "";
    let usedModel = "";

    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: 8192,
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

    // Parse JSON response
    try {
      // Strip markdown fences if present
      let jsonStr = responseText;
      const jsonStart = jsonStr.indexOf("{");
      const jsonEnd = jsonStr.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);
      }

      const result = JSON.parse(jsonStr);
      return NextResponse.json({ ...result, model: usedModel });
    } catch {
      // If JSON parse fails, return raw text
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
