import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { askClaudeJson } from "@/lib/ai/ask-json";
import { CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Is the AI reader up, and if not, WHY?
 *
 * Built after a day-long scanner outage that every screen reported as "try a
 * clearer photo" — five people re-shot receipts that were never the problem.
 * Open /api/ai/health signed in and it answers in one line: does a plain text
 * call work, does a VISION call work (the scanners send images and PDFs, and
 * those can fail on their own), and what did the API actually say.
 */

// 1x1 PNG — the smallest thing that proves the vision path end to end.
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export async function GET() {
  const user = await getUser();
  if (!(user?.profile?.id ?? user?.id)) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const check = async (label: string, content: Array<Record<string, unknown>>) => {
    const startedAt = Date.now();
    const result = await askClaudeJson(content, 200, `health/${label}`);
    return {
      ok: result.ok,
      ms: Date.now() - startedAt,
      ...(result.ok
        ? { model: result.model }
        : { reason: result.failure.kind, detail: result.failure.detail }),
    };
  };

  const text = await check("text", [
    { type: "text", text: 'Return ONLY this JSON: {"ok": true}' },
  ]);

  const vision = await check("vision", [
    { type: "image", source: { type: "base64", media_type: "image/png", data: PIXEL } },
    { type: "text", text: 'Look at the image. Return ONLY this JSON: {"ok": true}' },
  ]);

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    keySource: process.env.CLAUDE_KEY
      ? "env CLAUDE_KEY"
      : process.env.ANTHROPIC_API_KEY
        ? "env ANTHROPIC_API_KEY"
        : process.env.ANTHROPIC_KEY
          ? "env ANTHROPIC_KEY"
          : "app_settings.anthropic_api_key",
    models: CLAUDE_FALLBACK_MODELS,
    text,
    vision,
    // The scanners need BOTH. Text alone passing is exactly the shape of the
    // 8/26 outage: chat kept answering while every receipt scan died.
    scannersUsable: text.ok && vision.ok,
  });
}
