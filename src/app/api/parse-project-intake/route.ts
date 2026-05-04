import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, nowStamp, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";

const SYSTEM_PROMPT = `You are an intake parser for a residential general contractor. The user is sending you either a voice transcript or a picture (handwritten note, business card, screenshot, sketch, contact form, photo of a written estimate). Extract the structured fields about the new job they want to create.

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
- Skip any field the source didn't mention. Empty/missing > guessing.
- "smith" → first_name "" + last_name "Smith" (only set last name unless first is given).
- Convert spoken/written money to numbers: "fifty K" → 50000, "$2,500" → 2500.
- Convert relative dates to absolute using the current date below. "Friday at 3" → next Friday at 15:00.
- description: clean up filler words / OCR noise but keep all factual content. Don't invent scope.
- project_type: default "remodel" if scope clearly is remodel-shaped (kitchen, bath, etc.) but user didn't specify a category; otherwise omit.
- For images: read every legible word, including handwriting. Phone numbers, emails, and addresses are highest priority.
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

type ImagePayload = {
  base64: string;
  media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
};

const ALLOWED_IMAGE_TYPES: ImagePayload["media_type"][] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { transcript, image } = await request.json() as {
      transcript?: string;
      image?: ImagePayload;
    };

    const hasTranscript = typeof transcript === "string" && transcript.trim().length > 0;
    const hasImage =
      image &&
      typeof image.base64 === "string" &&
      image.base64.length > 0 &&
      ALLOWED_IMAGE_TYPES.includes(image.media_type);

    if (!hasTranscript && !hasImage) {
      return NextResponse.json({ error: "Provide transcript or image" }, { status: 400 });
    }

    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: ImagePayload["media_type"]; data: string } }
    > = [];

    if (hasImage) {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: image!.media_type, data: image!.base64 },
      });
    }
    userContent.push({
      type: "text",
      text: hasTranscript
        ? transcript!.trim()
        : "Extract the new-job intake fields from this image.",
    });

    const anthropic = await getAnthropicClient();
    const system = `Current date & time: ${nowStamp()}\n\n${SYSTEM_PROMPT}`;

    let raw = "";
    let lastErr: unknown = null;
    for (const model of CLAUDE_FALLBACK_MODELS) {
      try {
        const message = await anthropic.messages.create({
          model,
          max_tokens: 800,
          system,
          messages: [{ role: "user", content: userContent }],
        });
        const text = message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
        if (text) {
          raw = text;
          break;
        }
      } catch (e) {
        lastErr = e;
        continue;
      }
    }

    if (!raw) {
      console.error("parse-project-intake: all models failed", lastErr);
      return NextResponse.json({ error: "AI request failed" }, { status: 502 });
    }

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
