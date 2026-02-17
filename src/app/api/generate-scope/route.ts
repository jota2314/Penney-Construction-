import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a senior residential construction estimator with 20+ years of experience writing scopes of work for proposals.

When given a line item name, project context, and optionally the estimator's verbal description, write a thorough and professional scope of work.

Rules:
- Use 4-8 concise bullet points starting with •
- Be SPECIFIC to the project type and context provided — a kitchen demolition scope is completely different from a bathroom demolition scope
- Include all standard sub-tasks that an experienced GC would include. For example:
  - Framing: always include blocking, backing for TV mounts/cabinets/grab bars, headers for openings, engineered lumber where required, Simpson ties/connectors
  - Demolition: specify what is being removed (cabinets, flooring, drywall, fixtures, etc.), protection of adjacent areas, debris hauling and disposal
  - Plumbing: rough-in, fixture installation, supply lines, drain/waste/vent, shut-off valves, testing
  - Electrical: rough-in, finish trim, panels/subpanels if needed, dedicated circuits, low voltage/data, fixture installation
  - Drywall: hanging, taping, mudding, texture matching, sanding, primer coat
  - Tile: substrate prep, waterproofing/membrane, tile setting, grout, caulk, edge trim
- Use professional construction language — write like it will appear on a signed proposal
- If the estimator provided a verbal description, use their specific details as the primary basis. Keep everything they mentioned, add any standard items they may have missed, and rewrite in professional language.
- Do NOT include any pricing, dollar amounts, or cost references
- Do NOT include a title, header, or the line item name — just the bullet points
- Do NOT use vague language like "as needed" or "if applicable" — be definitive about what is included`;

export async function POST(request: Request) {
  try {
    const {
      itemName,
      dictation,
      projectType,
      projectName,
      projectAddress,
      projectOverview,
    } = await request.json();

    if (!itemName || typeof itemName !== "string" || !itemName.trim()) {
      return NextResponse.json(
        { error: "itemName is required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    // Build project context string
    const contextParts: string[] = [];
    if (projectType) contextParts.push(`Project type: ${projectType}`);
    if (projectName) contextParts.push(`Project name: ${projectName}`);
    if (projectAddress) contextParts.push(`Location: ${projectAddress}`);
    if (projectOverview) contextParts.push(`Project overview: ${projectOverview}`);
    const projectContext = contextParts.length > 0
      ? `\n\nProject context:\n${contextParts.join("\n")}`
      : "";

    // Build user message
    let userMessage = `Write a scope of work for the line item: "${itemName.trim()}"`;
    if (dictation) {
      userMessage += `\n\nThe estimator described this work verbally as:\n"${dictation}"`;
      userMessage += "\n\nUse their description as the primary basis — keep every specific detail they mentioned, add standard items they may have missed, and rewrite everything in professional proposal language.";
    }
    userMessage += projectContext;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 500,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    const scope = completion.choices[0]?.message?.content?.trim() ?? "";

    return NextResponse.json({ scope });
  } catch (error) {
    console.error("generate-scope error:", error);
    return NextResponse.json(
      { error: "Failed to generate scope" },
      { status: 500 }
    );
  }
}
