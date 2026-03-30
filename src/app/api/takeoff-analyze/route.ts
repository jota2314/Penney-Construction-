import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { drawingText, scopeOfWork, filename, question } = await request.json();

  const systemPrompt = `You are a construction estimator helping with a takeoff on ONE specific architectural drawing for a residential GC on the North Shore of Massachusetts.

IMPORTANT: Only analyze THIS specific drawing. Do not reference other drawings or pages.

Drawing filename: ${filename || "Unknown"}

Drawing content (extracted text from this PDF):
${(drawingText || "").substring(0, 8000)}

${question ? "Answer the user's question about this drawing." : `Generate a takeoff checklist. Return ONLY a JSON array of items to measure. Each item:
- "label": specific name (e.g., "West Elevation - Siding", "Garage Door Opening")
- "type": "linear" (lengths in ft), "area" (surfaces in sqft), or "count" (items like windows)
- "trade": trade category (siding, framing, roofing, windows, foundation, electrical, etc.)
- "description": what to measure and where on the drawing

Be specific to what's shown in the drawing. Include 8-15 items ordered by trade.
Return JSON array only, no markdown fences, no other text.`}`;

  try {
    const anthropic = await getAnthropicClient();
    let responseText = "";

    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: 2048,
          system: question ? systemPrompt : undefined,
          messages: [{
            role: "user",
            content: question || systemPrompt,
          }],
        });
        responseText = response.content[0]?.type === "text" ? response.content[0].text : "";
        if (responseText) break;
      } catch {
        continue;
      }
    }

    if (!responseText) {
      return NextResponse.json({ error: "AI failed" }, { status: 500 });
    }

    // For checklist requests, parse JSON
    if (!question) {
      try {
        const jsonStart = responseText.indexOf("[");
        const jsonEnd = responseText.lastIndexOf("]");
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
          const items = JSON.parse(responseText.substring(jsonStart, jsonEnd + 1));
          return NextResponse.json({ checklist: items });
        }
      } catch {
        // Return raw text if JSON parse fails
      }
    }

    return NextResponse.json({ message: responseText });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
