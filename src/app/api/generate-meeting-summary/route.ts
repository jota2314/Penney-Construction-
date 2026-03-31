import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";

const SYSTEM_PROMPT = `You are a senior residential construction pre-construction manager preparing a professional meeting summary after a client site visit.

Given the meeting notes (which may be rough, voice-dictated, or shorthand), photos descriptions, and project context, produce a clean, organized meeting document.

Format the output as markdown with these sections (skip any section that has no relevant info):

## Client Information
Name, contact info, property address

## Project Overview
What the client wants, project type, scope description

## Site Conditions
Current state of the space, structural notes, access issues, anything observed on site

## Client Preferences
Design preferences, materials, finishes, fixtures, colors, styles mentioned

## Measurements & Specifications
Any dimensions, square footage, quantities mentioned

## Key Decisions
Decisions made or discussed during the meeting

## Budget Discussion
Budget range, priorities, value engineering notes

## Next Steps
Action items, follow-up tasks, timeline

Rules:
- Clean up grammar and organize scattered notes into the right sections
- Keep all specific details — dimensions, product names, colors, brands
- Use professional language but keep the client's intent
- Use bullet points within sections for clarity
- If notes mention photos, reference them naturally (e.g. "As seen in the site photos...")
- Do NOT invent information not in the notes`;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { notes, projectType, clientName, address, fileUrls } =
      await request.json();

    if (!notes || !Array.isArray(notes) || notes.length === 0) {
      return NextResponse.json(
        { error: "At least one note is required" },
        { status: 400 }
      );
    }

    // Build context
    const contextParts: string[] = [];
    if (clientName) contextParts.push(`Client: ${clientName}`);
    if (address) contextParts.push(`Address: ${address}`);
    if (projectType) contextParts.push(`Project type: ${projectType}`);

    const context =
      contextParts.length > 0 ? `Context:\n${contextParts.join("\n")}\n\n` : "";

    const notesText = notes
      .map(
        (n: { content: string; source: string }, i: number) =>
          `Note ${i + 1} (${n.source}): ${n.content}`
      )
      .join("\n");

    const photoInfo =
      fileUrls && fileUrls.length > 0
        ? `\n\n${fileUrls.length} site photo(s) were taken during this visit.`
        : "";

    const userMessage = fileUrls && fileUrls.length > 0
      ? `${context}Meeting Notes:\n${notesText}${photoInfo}\n\nPlease organize these notes and photos into a professional meeting summary.`
      : `${context}Meeting Notes:\n${notesText}\n\nPlease organize these notes into a professional meeting summary.`;

    const summary = await callClaude(`Current date & time: ${nowStamp()}\n\n${SYSTEM_PROMPT}`, userMessage, 2000);

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("generate-meeting-summary error:", error);
    return NextResponse.json(
      { error: "Failed to generate meeting summary" },
      { status: 500 }
    );
  }
}
