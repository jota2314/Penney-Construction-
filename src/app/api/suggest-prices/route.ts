import { NextResponse } from "next/server";
import OpenAI from "openai";

const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a senior residential construction estimator who prices jobs for a general contractor in the northeastern United States.

Given a list of line items with their scopes of work, project type, and location, suggest realistic prices.

Rules:
- Base prices on current market rates for residential construction
- Consider the location and project type
- These are GC prices (include subcontractor costs + GC markup)
- Return a JSON object with a "prices" array
- Each entry: { "index": number, "price": number, "note": "brief 5-word reason" }
- index is the 0-based position in the input array
- price is the suggested dollar amount (no cents needed for estimates)
- If the scope is empty or unclear, give a reasonable range-midpoint based on the item name
- Be realistic — residential GC prices, not retail`;

export async function POST(request: Request) {
  try {
    const { lineItems, projectType, projectAddress } = await request.json();

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return NextResponse.json(
        { error: "lineItems array is required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    const itemDescriptions = lineItems
      .map(
        (item: { name: string; scope: string }, i: number) =>
          `${i}. "${item.name}" — Scope: ${item.scope || "(no scope written)"}`
      )
      .join("\n");

    const userMessage = `Project type: ${projectType || "Residential"}
Location: ${projectAddress || "Northeast US"}

Line items to price:
${itemDescriptions}

Return JSON with suggested prices for each item.`;

    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1000,
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
      prices: Array.isArray(result.prices) ? result.prices : [],
    });
  } catch (error) {
    console.error("suggest-prices error:", error);
    return NextResponse.json(
      { error: "Failed to suggest prices" },
      { status: 500 }
    );
  }
}
