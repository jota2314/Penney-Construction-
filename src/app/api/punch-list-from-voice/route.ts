import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";

/**
 * Parse a voice-dictated punch list into structured items.
 *
 * Caller dictates "kitchen window doesn't latch, baseboard gap behind
 * the fridge, paint touch-up master bath" — we return one row per item:
 *   [
 *     { description: "Window above sink doesn't latch", location: "Kitchen", priority: "medium" },
 *     { description: "Caulk gap in baseboard behind fridge", location: "Kitchen", priority: "low" },
 *     { description: "Paint touch-up", location: "Master bath", priority: "low" },
 *   ]
 *
 * Caller previews + bulk-inserts via createPunchListItems.
 */

const SYSTEM_PROMPT = `You are a field assistant for a residential general contractor. Parse the user's voice-dictated rambling into a JSON array of distinct punch-list items.

Rules:
- One JSON object per distinct work item, even if the user grouped several together in one sentence.
- Each item: { "description": string, "location": string | null, "priority": "low" | "medium" | "high" }
- "description" is action-oriented and brief — what needs doing. Use trade language ("caulk", "shim", "touch up", "re-trim", "patch"). No filler.
- "location" is the room/area if mentioned ("Master bath", "Kitchen", "Living room", "Garage"). null if not mentioned.
- "priority" defaults to "medium". Use "high" only if the user said urgent / inspector / final walk / closing. Use "low" for cosmetic touch-ups.
- Don't invent items. If the user mentioned 3 things, return 3 items.
- Return ONLY the JSON array. No prose, no preamble, no \`\`\`json fences.`;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { text } = (await request.json()) as { text?: string };
    if (!text || !text.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const systemPrompt = `Current date & time: ${nowStamp()}\n\n${SYSTEM_PROMPT}`;
    const raw = await callClaude(systemPrompt, text.trim(), 1500);

    let items: Array<{ description: string; location: string | null; priority: string }> = [];
    try {
      const cleaned = raw.replace(/^```json\s*|\s*```$/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        items = parsed
          .filter((p) => p && typeof p.description === "string" && p.description.trim())
          .map((p) => ({
            description: String(p.description).trim(),
            location: typeof p.location === "string" && p.location.trim() ? String(p.location).trim() : null,
            priority: ["low", "medium", "high"].includes(p.priority) ? String(p.priority) : "medium",
          }));
      }
    } catch (err) {
      console.error("[punch-list-from-voice] failed to parse JSON:", err, "raw:", raw);
      return NextResponse.json({ error: "AI returned malformed list — try again" }, { status: 500 });
    }

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[punch-list-from-voice] failed:", err);
    return NextResponse.json({ error: "Failed to parse list" }, { status: 500 });
  }
}
