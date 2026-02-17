import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a senior residential construction estimator with 20+ years of experience creating complete estimates for residential remodeling and new construction projects.

Given a project description, type, and optionally photos/drawings, generate a COMPLETE list of line items needed for the project.

Rules:
- Generate ALL trades and work items needed for the described work — do not skip anything
- Order items in construction sequence: demolition → structural → rough-ins (plumbing, electrical, HVAC) → insulation → drywall → finishes (tile, flooring, paint, trim) → fixtures/appliances → cleanup
- Include items homeowners commonly forget: permits, engineering/plans, temporary protection, dumpster/hauling, final cleaning
- For each line item, provide:
  - "description": short item name (e.g., "Demolition", "Framing", "Electrical Rough-In")
  - "proposal_description": 4-8 bullet points starting with • describing the scope of work in professional proposal language
  - "total_price": a rough ballpark estimate in dollars (this is a starting point for the estimator to refine, NOT a final price)
- Scope bullet points must be SPECIFIC to the project described — reference actual details from the description and photos
- Do NOT use vague language like "as needed" or "if applicable" — be definitive
- Do NOT include pricing or dollar amounts in the scope bullet points
- Do NOT include a project summary item — only construction work items
- If photos are provided, reference specific visible details (existing conditions, materials, layout, damage, etc.)

Respond with valid JSON in this exact format:
{
  "lineItems": [
    {
      "description": "Item Name",
      "proposal_description": "• Bullet 1\\n• Bullet 2\\n• Bullet 3",
      "total_price": 5000
    }
  ]
}`;

export async function POST(request: Request) {
  try {
    const {
      projectType,
      projectName,
      projectAddress,
      projectDescription,
      fileUrls,
    } = await request.json();

    if (!projectDescription || typeof projectDescription !== "string" || !projectDescription.trim()) {
      return NextResponse.json(
        { error: "Project description is required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    // Build user message with project context
    const contextParts: string[] = [];
    if (projectType) contextParts.push(`Project type: ${projectType}`);
    if (projectName) contextParts.push(`Project name: ${projectName}`);
    if (projectAddress) contextParts.push(`Location: ${projectAddress}`);
    contextParts.push(`\nProject description:\n${projectDescription.trim()}`);

    const userText = `Generate a complete estimate for this residential construction project:\n\n${contextParts.join("\n")}`;

    // Build content array with text + images
    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: "text", text: userText },
    ];

    // Add images if provided
    if (Array.isArray(fileUrls) && fileUrls.length > 0) {
      for (const url of fileUrls) {
        if (typeof url === "string" && url.startsWith("http")) {
          content.push({
            type: "image_url",
            image_url: { url, detail: "high" },
          });
        }
      }
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4000,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";

    let parsed: { lineItems?: unknown[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "AI returned invalid JSON" },
        { status: 500 }
      );
    }

    if (!Array.isArray(parsed.lineItems)) {
      return NextResponse.json(
        { error: "AI response missing lineItems array" },
        { status: 500 }
      );
    }

    // Validate and sanitize each line item
    const lineItems = parsed.lineItems
      .filter(
        (item): item is { description: string; proposal_description?: string; total_price?: number } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).description === "string" &&
          ((item as Record<string, unknown>).description as string).trim().length > 0
      )
      .map((item) => ({
        description: item.description.trim(),
        proposal_description:
          typeof item.proposal_description === "string"
            ? item.proposal_description.trim()
            : "",
        total_price:
          typeof item.total_price === "number" && item.total_price >= 0
            ? Math.round(item.total_price * 100) / 100
            : 0,
      }));

    return NextResponse.json({ lineItems });
  } catch (error) {
    console.error("generate-estimate error:", error);
    return NextResponse.json(
      { error: "Failed to generate estimate" },
      { status: 500 }
    );
  }
}
