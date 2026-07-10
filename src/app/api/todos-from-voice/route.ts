import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";

/**
 * Parse a spoken or typed todo request into structured todos.
 *
 * Caller dictates "call Mike about the Gloucester permit, order tile for
 * Burns Kitchen tomorrow, follow up with Picardi on the 74 Cavendish quote"
 * — we return one row per item with action-oriented descriptions and
 * (when mentioned) due dates.
 */

const SYSTEM_PROMPT = `You are an assistant for a residential general contractor. Parse the user's request into a JSON array of distinct todos.

Rules:
- One JSON object per distinct task, even if grouped together in one sentence.
- Each item: { "description": string, "priority": "low" | "medium" | "high", "due_date": string | null, "contact_name": string | null }
- "description" is action-oriented and starts with a verb: "Call ...", "Order ...", "Confirm ...", "Schedule ...", "Follow up with ...", "Email ..."
- "priority" defaults to "medium". Use "high" only if the user said urgent / today / asap / inspector / closing. Use "low" for non-time-sensitive routine work.
- "due_date" is an ISO date "YYYY-MM-DD" if the user mentioned a date, day-of-week, or relative day ("tomorrow", "Friday", "next Monday"). null otherwise. Use the current date below to resolve relative dates.
- "contact_name" is the person to contact if mentioned ("Mike", "Picardi", "the inspector"). null otherwise.
- Don't invent items. If the user mentioned 3 things, return 3 items.
- Return ONLY the JSON array. No prose, no preamble, no \`\`\`json fences.`;

const requestSchema = z.object({
  text: z.string().trim().min(1, "text is required").max(5000, "text is too long"),
});

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const input = requestSchema.safeParse(body);
    if (!input.success) {
      return NextResponse.json(
        { error: input.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }

    const systemPrompt = `Current date & time: ${nowStamp()}\n\n${SYSTEM_PROMPT}`;
    const raw = await callClaude(systemPrompt, input.data.text, 1500);

    let items: Array<{ description: string; priority: string; due_date: string | null; contact_name: string | null }> = [];
    try {
      const cleaned = raw.replace(/^```json\s*|\s*```$/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        items = parsed
          .filter((p) => p && typeof p.description === "string" && p.description.trim())
          .map((p) => ({
            description: String(p.description).trim(),
            priority: ["low", "medium", "high"].includes(p.priority) ? String(p.priority) : "medium",
            due_date: typeof p.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.due_date) ? p.due_date : null,
            contact_name: typeof p.contact_name === "string" && p.contact_name.trim() ? String(p.contact_name).trim() : null,
          }));
      }
    } catch (err) {
      console.error("[todos-from-voice] failed to parse JSON:", err, "raw:", raw);
      return NextResponse.json({ error: "AI returned malformed list — try again" }, { status: 500 });
    }

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[todos-from-voice] failed:", err);
    return NextResponse.json(
      { error: "AI is temporarily unavailable — please try again" },
      { status: 503 },
    );
  }
}
