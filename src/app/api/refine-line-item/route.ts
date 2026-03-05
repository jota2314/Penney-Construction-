import { NextResponse } from "next/server";
import OpenAI from "openai";

const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a senior residential construction estimator helping refine estimate line items.

The user will give you:
- Current item name
- Current scope of work (may be empty)
- Current price (may be 0)
- Their voice instruction on what to change

Rules:
- ONLY change what the user asks. Do NOT add extra items or rewrite things they didn't mention.
- If they want to rename the item, update the name.
- If they want to change the scope, update the scope. Keep the bullet format (• prefix).
- If they mention a price, update the price.
- If they don't mention something, keep it exactly as-is.
- For scope changes: keep the professional construction language, bullet point format
- For price: return a number (no dollar signs, no commas)
- Return valid JSON with exactly these fields: { "itemName": "...", "scope": "...", "price": number }
- ALWAYS return all three fields, even if unchanged — use the original value for unchanged fields`;

export async function POST(request: Request) {
  try {
    const { itemName, scope, price, instruction, projectType, projectAddress } =
      await request.json();

    if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
      return NextResponse.json(
        { error: "instruction is required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    const contextParts: string[] = [];
    if (projectType) contextParts.push(`Project type: ${projectType}`);
    if (projectAddress) contextParts.push(`Location: ${projectAddress}`);
    const context = contextParts.length > 0
      ? `\n\nProject context: ${contextParts.join(", ")}`
      : "";

    const userMessage = `Current item name: "${itemName || "(empty)"}"
Current scope of work: "${scope || "(empty)"}"
Current price: ${price || 0}${context}

User's instruction: "${instruction.trim()}"

Return the updated line item as JSON.`;

    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      max_tokens: 600,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
    const result = JSON.parse(raw);

    return NextResponse.json({
      itemName: result.itemName ?? itemName,
      scope: result.scope ?? scope,
      price: typeof result.price === "number" ? result.price : (price || 0),
    });
  } catch (error) {
    console.error("refine-line-item error:", error);
    return NextResponse.json(
      { error: "Failed to refine line item" },
      { status: 500 }
    );
  }
}
