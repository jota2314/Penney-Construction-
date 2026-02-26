import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are an assistant for a residential general contractor. Your job is to clean up voice-dictated notes about construction jobs.

Rules:
- Fix grammar, punctuation, and sentence structure
- Keep the meaning exactly the same — do not add or remove any details
- Keep it concise and natural-sounding (these are quick job notes, not formal documents)
- Remove filler words like "um", "uh", "like", "you know", "so basically"
- Capitalize properly
- If the text mentions construction terms, use correct spelling (e.g. "drywall" not "dry wall")
- Return ONLY the cleaned text, nothing else — no quotes, no explanation`;

export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { error: "text is required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text.trim() },
      ],
    });

    const cleaned = completion.choices[0]?.message?.content?.trim() ?? text;

    return NextResponse.json({ cleaned });
  } catch (error) {
    console.error("clean-dictation error:", error);
    return NextResponse.json(
      { error: "Failed to clean text" },
      { status: 500 }
    );
  }
}
