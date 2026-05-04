import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, nowStamp } from "@/lib/ai/claude";

const SYSTEM_PROMPT = `You are an intake parser for a residential general contractor. The user is dictating notes about a new job they want to create. Extract the structured fields from their dictation.

Return ONLY valid JSON, nothing else, with this exact shape (omit fields you can't determine — do NOT guess):

{
  "name": string,                      // short job name like "Smith Kitchen Remodel"
  "customer_first_name": string,
  "customer_last_name": string,
  "customer_phone": string,            // digits and dashes
  "customer_email": string,
  "address": string,                   // street + number only, no city/state/zip
  "city": string,
  "state": string,                     // 2-letter
  "zip": string,
  "project_type": "remodel" | "addition" | "new_construction" | "repair" | "renovation" | "other",
  "description": string,               // 1-2 sentence scope summary, cleaned up grammar
  "estimated_value": number,           // dollars, no commas
  "walkthrough_date": string,          // ISO 8601 datetime "YYYY-MM-DDTHH:mm" in America/New_York
  "referral_source": "referral" | "google" | "facebook" | "website" | "other",
  "referral_detail": string            // who referred / which platform
}

Rules:
- Skip any field the user didn't mention. Empty/missing > guessing.
- "smith" → first_name "" + last_name "Smith" (only set last name unless first is given).
- Convert spoken money to numbers: "fifty K" → 50000, "two hundred grand" → 200000.
- Convert relative dates to absolute using the current date below. "Friday at 3" → next Friday at 15:00.
- description: clean up filler words but keep all factual content. Don't invent scope.
- project_type: default "remodel" if scope clearly is remodel-shaped (kitchen, bath, etc.) but user didn't specify a category; otherwise omit.
- Output JSON only. No markdown fences, no commentary.`;

type ParsedIntake = {
  name?: string;
  customer_first_name?: string;
  customer_last_name?: string;
  customer_phone?: string;
  customer_email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  project_type?: string;
  description?: string;
  estimated_value?: number;
  walkthrough_date?: string;
  referral_source?: string;
  referral_detail?: string;
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { transcript } = await request.json();

    if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
      return NextResponse.json({ error: "transcript is required" }, { status: 400 });
    }

    const raw = await callClaude(
      `Current date & time: ${nowStamp()}\n\n${SYSTEM_PROMPT}`,
      transcript.trim(),
      800,
    );

    // Strip code fences if Claude added them despite the rule.
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed: ParsedIntake = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "Could not parse intake", raw }, { status: 422 });
    }

    return NextResponse.json({ parsed });
  } catch (error) {
    console.error("parse-project-intake error:", error);
    return NextResponse.json({ error: "Failed to parse intake" }, { status: 500 });
  }
}
