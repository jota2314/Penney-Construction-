import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";

/**
 * Summarize a recorded client meeting (project_meetings row) into a clean
 * summary + extracted action items the PM can review before saving.
 */

const SYSTEM_PROMPT = `You are an assistant for a residential general contractor's project manager who just finished a meeting with a CLIENT on a job site.

You get raw meeting notes (mostly voice-dictated, may be rough or rambling). Produce a JSON object:

{
  "summary": "<markdown summary>",
  "action_items": [ { "description": "...", "priority": "low" | "medium" | "high" } ]
}

The markdown summary uses these sections (skip empty ones):
## What was discussed
## Client requests & concerns
## Decisions made
## Changes to scope
## Next steps

Rules for the summary:
- Clean up the grammar and organize scattered notes, but keep ALL specifics: dimensions, products, colors, brands, dollar amounts, dates, names.
- Professional but plain language — this may be shared with the client.
- Do NOT invent anything not in the notes.

Rules for action_items:
- One item per distinct task the PM or the company must do. Start with a verb ("Order ...", "Call ...", "Schedule ...", "Send ...", "Fix ...").
- Include items the client asked for, punch-list-type fixes mentioned, and follow-ups promised.
- "high" only for urgent/safety/inspection/blocking items; default "medium".
- No duplicates. If there are no action items, return an empty array.

Return ONLY the JSON object. No prose, no markdown fences.`;

const requestSchema = z.object({
  meetingId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const input = requestSchema.safeParse(body);
    if (!input.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { data: meeting, error } = await supabase
      .from("project_meetings")
      .select(
        "id, notes, title, meeting_date, project:projects(name, project_type, address, customer:customers(first_name, last_name))"
      )
      .eq("id", input.data.meetingId)
      .single();
    if (error || !meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    const notes = (meeting.notes ?? []) as Array<{
      content: string;
      source: string;
    }>;
    if (notes.length === 0) {
      return NextResponse.json(
        { error: "No notes to summarize — record or type something first." },
        { status: 400 }
      );
    }

    const project = meeting.project as unknown as {
      name: string;
      project_type: string | null;
      address: string | null;
      customer: { first_name: string | null; last_name: string | null } | null;
    } | null;
    const clientName = [
      project?.customer?.first_name,
      project?.customer?.last_name,
    ]
      .filter(Boolean)
      .join(" ");

    const contextParts = [
      project?.name ? `Project: ${project.name}` : null,
      clientName ? `Client: ${clientName}` : null,
      project?.address ? `Address: ${project.address}` : null,
      project?.project_type ? `Project type: ${project.project_type}` : null,
    ].filter(Boolean);

    const notesText = notes
      .map((n, i) => `Note ${i + 1} (${n.source}): ${n.content}`)
      .join("\n");

    const userMessage = `${contextParts.length ? `Context:\n${contextParts.join("\n")}\n\n` : ""}Meeting notes:\n${notesText}`;

    const raw = await callClaude(
      `Current date & time: ${nowStamp()}\n\n${SYSTEM_PROMPT}`,
      userMessage,
      3000
    );

    let summary = "";
    const actionItems: Array<{ description: string; priority: string }> = [];
    try {
      const cleaned = raw.replace(/^```json\s*|\s*```$/g, "").trim();
      const parsed = JSON.parse(cleaned);
      summary = typeof parsed.summary === "string" ? parsed.summary : "";
      if (Array.isArray(parsed.action_items)) {
        for (const a of parsed.action_items as Array<{
          description?: unknown;
          priority?: unknown;
        }>) {
          if (!a || typeof a.description !== "string" || !a.description.trim())
            continue;
          actionItems.push({
            description: a.description.trim(),
            priority:
              typeof a.priority === "string" &&
              ["low", "medium", "high"].includes(a.priority)
                ? a.priority
                : "medium",
          });
        }
      }
    } catch {
      // Model returned prose instead of JSON — use it as the summary.
      summary = raw.trim();
    }

    if (!summary) {
      return NextResponse.json(
        { error: "Could not generate a summary — try again." },
        { status: 502 }
      );
    }

    return NextResponse.json({ summary, action_items: actionItems });
  } catch (err) {
    console.error("project-meeting-summary error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Summary failed" },
      { status: 500 }
    );
  }
}
