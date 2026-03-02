import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PRECON_PROMPT = `You are a senior residential construction estimator documenting a site visit to scope and price a new project.

Given the site visit notes (which may be rough, voice-dictated, or shorthand), photo descriptions, and project context, produce a clean, organized site visit report focused on what's needed for estimating.

Format the output as markdown with these sections (skip any section that has no relevant info):

## Site Conditions
Lot access, grade/slope, soil conditions, existing structures, demolition needed, utilities available, setbacks observed

## Existing Structure
Current condition, layout, structural observations, foundation type, framing, roof condition, MEP condition (if applicable)

## Scope of Work
What the customer wants done, key features requested, design intent, special requirements

## Measurements & Dimensions
Any dimensions noted, room sizes, elevations, square footage observations

## Estimating Considerations
Factors that will affect pricing — access difficulty, material requirements, specialty trades needed, permits likely required, potential surprises or unknowns

## Photos & Documentation
Reference to photos taken, what they document

## Follow-Up Items
Information still needed, measurements to confirm, questions for the customer, items to research for pricing

Rules:
- Clean up grammar and organize scattered notes into the right sections
- Keep all specific details — measurements, locations, material specs, customer requests
- Use professional construction language
- Use bullet points within sections for clarity
- Focus on what matters for creating an accurate estimate
- If notes mention photos, reference them naturally (e.g. "As documented in site photos...")
- Do NOT invent information not in the notes`;

const ACTIVE_JOB_PROMPT = `You are a senior residential construction project manager documenting a site visit to an active construction project.

Given the site visit notes (which may be rough, voice-dictated, or shorthand), photo descriptions, and project context, produce a clean, organized site visit report.

Format the output as markdown with these sections (skip any section that has no relevant info):

## Work Progress
Current status of trades on site, work completed since last visit, percent complete observations

## Quality Observations
Workmanship quality, materials installed correctly, any craftsmanship concerns

## Issues & Punch Items
Problems discovered, defects, items needing correction, RFIs needed

## Safety
Site safety observations, hazards, PPE compliance, housekeeping

## Materials & Deliveries
Materials on site, pending deliveries, storage conditions

## Schedule Impact
Any delays observed, weather impacts, trade coordination issues

## Photos & Documentation
Reference to photos taken, what they document

## Next Steps
Action items, follow-up needed, items to address before next visit

Rules:
- Clean up grammar and organize scattered notes into the right sections
- Keep all specific details — measurements, locations, trade names, material specs
- Use professional construction language
- Use bullet points within sections for clarity
- If notes mention photos, reference them naturally (e.g. "As documented in site photos...")
- Do NOT invent information not in the notes`;

function getSystemPrompt(summaryType?: string): string {
  return summaryType === "precon" ? PRECON_PROMPT : ACTIVE_JOB_PROMPT;
}

export async function POST(request: Request) {
  try {
    const {
      notes,
      projectName,
      projectType,
      address,
      fileUrls,
      purpose,
      summaryType,
    } = await request.json();

    if (!notes || !Array.isArray(notes) || notes.length === 0) {
      return NextResponse.json(
        { error: "At least one note is required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    // Build context
    const contextParts: string[] = [];
    if (projectName) contextParts.push(`Project: ${projectName}`);
    if (address) contextParts.push(`Address: ${address}`);
    if (projectType) contextParts.push(`Project type: ${projectType}`);
    if (purpose) contextParts.push(`Visit purpose: ${purpose}`);

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

    const systemPrompt = getSystemPrompt(summaryType);

    // Build messages
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
    ];

    if (fileUrls && fileUrls.length > 0) {
      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        {
          type: "text",
          text: `${context}Site Visit Notes:\n${notesText}${photoInfo}\n\nPlease organize these notes and photos into a professional site visit report.`,
        },
        ...fileUrls.map(
          (url: string): OpenAI.Chat.Completions.ChatCompletionContentPart => ({
            type: "image_url",
            image_url: { url, detail: "low" },
          })
        ),
      ];
      messages.push({ role: "user", content });
    } else {
      messages.push({
        role: "user",
        content: `${context}Site Visit Notes:\n${notesText}\n\nPlease organize these notes into a professional site visit report.`,
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 2000,
      temperature: 0.3,
      messages,
    });

    const summary = completion.choices[0]?.message?.content?.trim() ?? "";

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("generate-site-visit-summary error:", error);
    return NextResponse.json(
      { error: "Failed to generate site visit summary" },
      { status: 500 }
    );
  }
}
