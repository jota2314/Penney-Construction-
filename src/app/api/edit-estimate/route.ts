import { NextResponse } from "next/server";
import OpenAI from "openai";

const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a senior residential construction estimator assistant. The user has an existing estimate with line items and wants to modify it via voice or text commands.

Given the current line items and the user's instruction, return the FULL updated list of line items with changes applied.

Common commands:
- Change a price: "bump framing to 15k", "electrical should be 8000"
- Add an item: "add landscaping for 5000", "add permit fees"
- Remove an item: "remove cleanup", "take out dumpster"
- Edit scope: "add crown molding to the trim scope", "framing should include a 12ft beam"
- Adjust multiple: "increase all prices by 10%", "double the plumbing"

Rules:
- Return ALL line items, not just changed ones — include unchanged items exactly as they were
- When changing a price, only change that specific item
- When adding, place it in logical construction sequence
- When removing, drop the item entirely
- For scope edits, update the proposal_description bullets
- If the command is unclear, make your best judgment as a construction estimator
- NEVER change items the user didn't mention
- Keep descriptions concise and professional

Respond with valid JSON:
{
  "lineItems": [
    {
      "description": "Item Name",
      "proposal_description": "scope bullets",
      "total_price": 5000
    }
  ],
  "changesSummary": "Brief description of what was changed"
}`;

export async function POST(request: Request) {
  try {
    const { command, currentLineItems, projectContext } = await request.json();

    if (!command || typeof command !== "string" || !command.trim()) {
      return NextResponse.json(
        { error: "Command is required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    // Build the current estimate as context
    const itemsList = (currentLineItems ?? [])
      .map(
        (item: { description: string; proposal_description?: string; total_price: number }, i: number) =>
          `${i + 1}. ${item.description} — $${item.total_price.toLocaleString()}${item.proposal_description ? `\n   Scope: ${item.proposal_description.substring(0, 200)}` : ""}`
      )
      .join("\n");

    const total = (currentLineItems ?? []).reduce(
      (sum: number, item: { total_price: number }) => sum + (item.total_price || 0),
      0
    );

    let contextStr = "";
    if (projectContext) {
      const parts: string[] = [];
      if (projectContext.projectName) parts.push(`Project: ${projectContext.projectName}`);
      if (projectContext.projectType) parts.push(`Type: ${projectContext.projectType}`);
      contextStr = parts.length > 0 ? `${parts.join(" | ")}\n\n` : "";
    }

    const userMessage = `${contextStr}Current Estimate (${(currentLineItems ?? []).length} items, total $${total.toLocaleString()}):\n${itemsList}\n\nUser command: "${command.trim()}"`;

    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4000,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";

    let parsed: { lineItems?: unknown[]; changesSummary?: string };
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

    const lineItems = parsed.lineItems
      .filter(
        (item): item is { description: string; proposal_description?: string; total_price?: number } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).description === "string"
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

    return NextResponse.json({
      lineItems,
      changesSummary: parsed.changesSummary || "Estimate updated",
    });
  } catch (error) {
    console.error("edit-estimate error:", error);
    return NextResponse.json(
      { error: "Failed to edit estimate" },
      { status: 500 }
    );
  }
}
