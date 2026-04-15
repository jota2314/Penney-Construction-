import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS, nowStamp, logAiUsage } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 180;

/**
 * POST /api/takeoff-measure-item
 *
 * Given ONE page of a drawing + a specific checklist item, ask Claude vision
 * to either:
 *   1. Read a printed dimension on the drawing and return the exact value, OR
 *   2. Return normalized (0-1) coordinates for a polyline / polygons / count markers
 *      so the client can draw the measurement ON the PDF for the user to verify.
 *   3. Give up cleanly with needs_manual=true if it can't see the feature.
 *
 * Coordinates are normalized to the submitted page image so the client can map
 * them onto the full-resolution ImageBitmap of the same page.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const {
    pageImage,         // base64 JPEG/PNG of the page, no data: prefix
    pageMediaType,     // "image/jpeg" | "image/png"
    pageNumber,        // integer, 1-based
    item,              // { label, type: "linear"|"area"|"count", trade, description }
    pixelsPerFoot,     // number | null — scale calibration at PDF image full-res
    pageImageWidth,    // width in px of the image being sent (client renders smaller for upload)
    pageImageHeight,   // height in px of the image being sent
    projectId,
    scopeOfWork,
    drawingText,
    filename,
  } = await request.json();

  if (!pageImage || !item?.label || !item?.type) {
    return NextResponse.json({ error: "Missing pageImage or item" }, { status: 400 });
  }

  let projectInfo = "";
  if (projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("name, address, project_type, scope_of_work")
      .eq("id", projectId)
      .single();
    if (project) {
      projectInfo = `\nProject: ${project.name}\nAddress: ${project.address || "N/A"}\nType: ${project.project_type || "residential"}\n${project.scope_of_work ? `Known scope: ${project.scope_of_work}` : ""}`;
    }
  }

  const scaleContext = pixelsPerFoot
    ? `The drawing is already scale-calibrated at ${Number(pixelsPerFoot).toFixed(2)} pixels per foot of real-world distance (measured against the FULL-resolution page image, not the thumbnail you see). You do not need to estimate scale — the client will convert pixel distances to feet using this calibration.`
    : `The drawing is NOT scale-calibrated yet. You may still propose geometry, but the client cannot compute exact feet until the user calibrates. Prefer reading a printed dimension string if one is visible.`;

  const typeInstructions = {
    linear: `This is a LINEAR measurement (feet). Acceptable outputs:
- method="printed": if a dimension string on the drawing (e.g., "24'-6\\"", "40'-0\\"") directly gives this measurement OR you can SUM labeled segments to get it, return the sum in feet.
- method="polyline": return a single polyline tracing the run. Must have at least 2 points, ordered tip-to-tail.
- method="manual": if the feature is not visible on this page or you can't trace it reliably.`,
    area: `This is an AREA measurement (square feet). Acceptable outputs:
- method="printed": if dimensions on the drawing let you compute area directly (e.g., "12' x 15'" = 180 sqft), sum all regions and return it.
- method="polygons": return one or more polygons covering the feature (e.g., each roof plane or each elevation wall as its own polygon). Each polygon needs 3+ points.
- method="manual": if you can't see the feature clearly.`,
    count: `This is a COUNT measurement (integer). Acceptable outputs:
- method="printed": if a schedule on the drawing lists the count, return it exactly.
- method="counts": return a marker {x,y} for EACH individual instance on the drawing (one per window, one per door, etc.). Client will count the markers.
- method="manual": if you can't identify the items reliably.`,
  };

  const systemPrompt = `You are a senior residential construction estimator analyzing ONE page of architectural drawings. Current date: ${nowStamp()}.
${projectInfo}
${scopeOfWork ? `\nProject scope: ${scopeOfWork}` : ""}
${drawingText ? `\nText extracted from PDF:\n${drawingText.substring(0, 3000)}` : ""}
${filename ? `\nFilename: ${filename}` : ""}

${scaleContext}

You are being asked to measure ONE specific item:
- Label: ${item.label}
- Type: ${item.type}
- Trade: ${item.trade || "N/A"}
- Description: ${item.description || "N/A"}

You are looking at page ${pageNumber || "?"} of the drawing set. The image you see is ${pageImageWidth}x${pageImageHeight} pixels.

${typeInstructions[item.type as keyof typeof typeInstructions] || typeInstructions.linear}

COORDINATE SYSTEM:
- All coordinates MUST be normalized to 0.0 - 1.0 of the image dimensions you see.
- x=0 is the LEFT edge, x=1 is the RIGHT edge.
- y=0 is the TOP edge, y=1 is the BOTTOM edge.
- Be as precise as you can, but be honest: if you're guessing more than a few percent, prefer method="manual" or lower the confidence.

CRITICAL RULES:
- If this page does not show the ${item.label} at all, return method="manual" with a reasoning explaining what page would likely have it.
- NEVER fabricate a value. Only set method="printed" when you can literally read the number(s) that compose the answer.
- For method="polyline"/"polygons"/"counts", coordinates must be grounded in what's actually visible — not guesses at where the feature "probably" is.
- Confidence: "high" = I can clearly read/trace the feature, "medium" = general location is clear but endpoints are approximate, "low" = best guess.

RESPOND WITH VALID JSON ONLY (no markdown fences):
{
  "method": "printed" | "polyline" | "polygons" | "counts" | "manual",
  "value": 129.5,               // number in the correct unit; omit for "manual"
  "unit": "ft" | "sqft" | "count",
  "confidence": "high" | "medium" | "low",
  "reasoning": "Short explanation — which page section, which dim string you read, or which features you traced.",
  "geometry": {
    "polyline": [{"x": 0.12, "y": 0.45}, {"x": 0.88, "y": 0.45}],
    "polygons": [[{"x": 0.1, "y": 0.1}, {"x": 0.5, "y": 0.1}, {"x": 0.5, "y": 0.4}, {"x": 0.1, "y": 0.4}]],
    "counts": [{"x": 0.3, "y": 0.4, "label": "W1"}]
  }
}

Include only the geometry keys that apply to the method you chose.`;

  try {
    const anthropic = await getAnthropicClient();

    type MediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    const mt = (pageMediaType || "image/jpeg") as MediaType;

    let responseText = "";
    let usedModel = "";

    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mt, data: pageImage },
              },
              {
                type: "text",
                text: `Measure "${item.label}" on this page. Respond with JSON only per the schema.`,
              },
            ],
          }],
        });
        usedModel = model;
        if (response.usage) {
          logAiUsage({
            userId: user.id,
            endpoint: "takeoff-measure-item",
            model,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            context: `${item.label} — p${pageNumber} — ${filename || ""}`,
          });
        }
        responseText = response.content[0]?.type === "text" ? response.content[0].text : "";
        if (responseText) break;
      } catch (err) {
        console.error(`takeoff-measure-item ${model} error:`, err);
        continue;
      }
    }

    if (!responseText) {
      return NextResponse.json({ error: "AI measurement failed" }, { status: 500 });
    }

    let jsonStr = responseText;
    const s = jsonStr.indexOf("{");
    const e = jsonStr.lastIndexOf("}");
    if (s !== -1 && e > s) jsonStr = jsonStr.substring(s, e + 1);

    try {
      const result = JSON.parse(jsonStr);
      return NextResponse.json({ ...result, model: usedModel });
    } catch {
      return NextResponse.json(
        { error: "AI returned non-JSON", raw: responseText.substring(0, 2000) },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("takeoff-measure-item error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Measurement failed" },
      { status: 500 }
    );
  }
}
