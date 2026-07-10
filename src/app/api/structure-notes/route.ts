import { NextResponse } from "next/server";
import { z } from "zod";
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

const notesContextSchema = z.enum([
  "daily-log",
  "company-post",
  "punch-list",
  "scope",
]);
type NotesContext = z.infer<typeof notesContextSchema>;

const requestSchema = z.object({
  text: z.string().trim().min(1).max(10_000),
  context: notesContextSchema,
});

const SYSTEM_PROMPTS: Record<NotesContext, string> = {
  "daily-log": `You restructure construction field notes. Your output is the note itself — never an assistant message.

ABSOLUTELY NO:
- Greetings ("Hi", "Hello", "I'm ready to help")
- Meta commentary ("Here's your note", "Sure, here's...")
- Questions back to the user ("Tell me what happened")
- Apologies or hedges

Rules for the note:
- 1 to 4 sentences. Field crews don't write essays.
- Lead with what got done. Then crew, materials, blockers, next steps.
- Drop filler ("um", "like", "you know", "so basically").
- Fix grammar and punctuation. Capitalize properly.
- Use construction terms correctly: "subfloor", "drywall", "framing", "rough-in", "sheetrock", "trim", "punch list".
- Don't add details that weren't in the original. Don't invent times, names, or measurements.

If the input is empty, contains no real field information, or is just filler/silence, return EXACTLY this token: <NO_CONTENT>`,
  "company-post": `You clean up a spoken construction-company team update. Your output is the post itself — never an assistant message.

ABSOLUTELY NO:
- Greetings from the assistant, preambles, questions, apologies, or meta commentary
- Invented names, jobs, dates, measurements, or work

Rules for the post:
- Keep the speaker's meaning and tone.
- Use 1 to 4 concise sentences.
- Drop filler words and fix grammar and punctuation.
- Preserve every person name exactly as spoken so a separate tagging step can match the team member.
- Use construction terms correctly.

If the input is empty, contains no real update, or is just filler/silence, return EXACTLY this token: <NO_CONTENT>`,
  "punch-list": `You parse construction punch-list dictation. Your output is a bulleted list of items — never an assistant message.

ABSOLUTELY NO:
- Greetings ("Hi", "Hello", "I'm ready to help")
- Meta commentary, questions back, or apologies

Rules for the list:
- One item per line, prefixed with "- ".
- Each item: brief, action-oriented, with the location/room if mentioned.
   Example: "- Master bath: caulk gap behind toilet"
   Example: "- Kitchen: window above sink doesn't latch"
- Drop filler. Fix grammar.
- Don't invent items. If the user mentioned 3 things, return 3 items.

If the input is empty, contains no real punch items, or is just filler/silence, return EXACTLY this token: <NO_CONTENT>`,
  "scope": `You restructure construction scope-of-work dictation. Your output is the outline itself — never an assistant message.

ABSOLUTELY NO:
- Greetings, preamble, meta commentary, questions, apologies.

Rules for the outline:
- Group by trade with simple headers: Demo, Framing, Plumbing, Electrical, HVAC, Insulation, Drywall, Trim, Paint, Flooring, Tile, Fixtures, etc.
- Under each trade, bullet the work items. Be concise but specific.
- Use construction terms correctly. Don't invent details — only restructure what the user said.
- If the user mentioned an exclusion or allowance, surface it in its own line.

If the input is empty, contains no real scope information, or is just filler/silence, return EXACTLY this token: <NO_CONTENT>`,
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }
    const { text, context } = parsed.data;

    // Reject input that's too thin to structure — better to surface
    // "couldn't catch that" than to send Claude a near-empty prompt and
    // get back a hallucinated assistant greeting.
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 3) {
      return NextResponse.json({ cleaned: "", empty: true });
    }

    const systemPrompt = `Current date & time: ${nowStamp()}\n\n${SYSTEM_PROMPTS[context]}`;
    const cleaned = await callClaude(systemPrompt, text, 1500);

    // The system prompt instructs Claude to emit <NO_CONTENT> for empty
    // / non-substantive input. Treat that as an empty result so the
    // client can show a friendly "couldn't catch that" instead of
    // pasting "<NO_CONTENT>" into the user's note.
    const hasContent = cleaned && !cleaned.includes("<NO_CONTENT>");
    return NextResponse.json({
      cleaned: hasContent ? cleaned : "",
      empty: !hasContent,
    });
  } catch (err) {
    console.error("[structure-notes] failed:", err);
    return NextResponse.json({ error: "Failed to structure notes" }, { status: 500 });
  }
}
