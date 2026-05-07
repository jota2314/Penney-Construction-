import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";

/**
 * Voice-to-structured-notes endpoint.
 *
 * Takes a raw transcript (already produced by browser SpeechRecognition)
 * and reformats it into clean, structured notes appropriate for the
 * caller's context. Same input pipeline, different "lens" depending on
 * whether you're capturing a daily log, punch list, or scope of work.
 */

type NotesContext = "daily-log" | "punch-list" | "scope";

const SYSTEM_PROMPTS: Record<NotesContext, string> = {
  "daily-log": `You are a field assistant for a residential general contractor. Turn the user's voice-dictated rambling into a clean, concise daily field log.

Rules:
- Keep it short — 1 to 4 sentences. Field crews don't write essays.
- Lead with what got done. Then crew, materials, blockers, next steps.
- Drop filler ("um", "like", "you know", "so basically", "yeah").
- Fix grammar and punctuation. Capitalize properly.
- Use construction terms correctly: "subfloor", "drywall", "framing", "rough-in", "sheetrock", "trim", "punch list".
- Don't add details that weren't in the original. Don't invent times, names, or measurements.
- Return ONLY the cleaned note. No quotes, no preamble, no "Here's your log".`,
  "punch-list": `You are a field assistant for a residential general contractor. Turn the user's voice-dictated rambling into a structured punch list.

Rules:
- One item per line, prefixed with "- ".
- Each item: brief, action-oriented, with the location/room if mentioned.
   Example: "- Master bath: caulk gap behind toilet"
   Example: "- Kitchen: window above sink doesn't latch"
- Drop filler. Fix grammar.
- Don't invent items. If the user only mentioned 3 things, return 3 items.
- Use trade language: "punch", "touch up", "caulk", "shim", "re-trim".
- Return ONLY the bulleted list. No preamble, no header, no totals.`,
  "scope": `You are an estimating assistant for a residential general contractor. Turn the user's voice-dictated rambling into a clean scope-of-work outline organized by trade.

Rules:
- Group by trade with simple headers: Demo, Framing, Plumbing, Electrical, HVAC, Insulation, Drywall, Trim, Paint, Flooring, Tile, Fixtures, etc.
- Under each trade, bullet the work items. Be concise but specific.
- Use construction terms correctly. Don't invent details — only restructure what the user said.
- If the user mentioned an exclusion or allowance, surface it in its own line.
- Return ONLY the outline. No preamble, no summary at the end.`,
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { text, context } = (await request.json()) as { text?: string; context?: NotesContext };

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    if (!context || !(context in SYSTEM_PROMPTS)) {
      return NextResponse.json(
        { error: "context must be 'daily-log', 'punch-list', or 'scope'" },
        { status: 400 }
      );
    }

    const systemPrompt = `Current date & time: ${nowStamp()}\n\n${SYSTEM_PROMPTS[context]}`;
    const cleaned = await callClaude(systemPrompt, text.trim(), 1500);

    return NextResponse.json({ cleaned: cleaned || text });
  } catch (err) {
    console.error("[structure-notes] failed:", err);
    return NextResponse.json({ error: "Failed to structure notes" }, { status: 500 });
  }
}
