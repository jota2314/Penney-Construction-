import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

/**
 * Get an authenticated Anthropic client.
 * Reads API key from Supabase app_settings first, then env vars.
 */
export async function getAnthropicClient(): Promise<Anthropic> {
  // Try env vars first (fastest)
  let apiKey = process.env.CLAUDE_KEY
    || process.env.ANTHROPIC_API_KEY
    || process.env.ANTHROPIC_KEY;

  // Fall back to Supabase app_settings
  if (!apiKey) {
    const supabase = await createClient();
    const { data: setting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "anthropic_api_key")
      .single();

    if (setting?.value) {
      apiKey = setting.value;
    }
  }

  if (!apiKey) {
    throw new Error("No Anthropic API key configured. Go to Settings to add your key.");
  }

  return new Anthropic({ apiKey });
}

/**
 * Returns the current date/time string for AI prompts.
 * Format: "Sunday, March 30, 2026 at 7:15 PM EDT"
 */
export function nowStamp(): string {
  const now = new Date().toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/New_York",
  });

  // Generate next 14 days calendar so AI never guesses wrong on dates
  const calendar: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const day = d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "America/New_York",
    });
    calendar.push(`  ${i === 0 ? "TODAY" : `+${i}`}: ${day}`);
  }

  return `${now}\n\nCALENDAR (use this for date math — do NOT guess):\n${calendar.join("\n")}`;
}

/** Primary model — Sonnet 4 (best cost/quality ratio) */
export const CLAUDE_MODEL = "claude-sonnet-4-20250514";

/** Latest Opus — Opus 4.6 (most intelligent; best for drawings analysis) */
export const CLAUDE_OPUS_4_6 = "claude-opus-4-6";

/** Premium model — Opus 4 (smartest, for main AI assistant) */
export const CLAUDE_OPUS = CLAUDE_OPUS_4_6;

/** Latest Sonnet — Sonnet 4.6 (main chat default; best cost/quality for everyday work) */
export const CLAUDE_SONNET_4_6 = "claude-sonnet-4-6";

/** Fallback models in order */
export const CLAUDE_FALLBACK_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-3-5-sonnet-20241022",
];

/** Sonnet fallback chain for main chat */
export const CLAUDE_SONNET_FALLBACK = [
  "claude-sonnet-4-6",
  "claude-sonnet-4-20250514",
];

/** Opus fallback chain for drawings analysis (takeoff-full-analyze, takeoff-scope-to-estimate) */
export const CLAUDE_OPUS_FALLBACK = [
  "claude-opus-4-6",
  "claude-opus-4-0-20250514",
  "claude-sonnet-4-20250514",
];

/** Cheap model for simple tasks like PDF text extraction */
export const CLAUDE_HAIKU = "claude-haiku-4-5-20251001";

// ── Cost tracking ────────────────────────────────────

// Pricing per million tokens (in cents)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6":               { input: 1500, output: 7500 },
  "claude-opus-4-0-20250514":      { input: 1500, output: 7500 },
  "claude-sonnet-4-6":             { input: 300,  output: 1500 },
  "claude-sonnet-4-20250514":      { input: 300,  output: 1500 },
  "claude-3-5-sonnet-20241022":    { input: 300,  output: 1500 },
  "claude-haiku-4-5-20251001":     { input: 80,   output: 400  },
};

/**
 * Calculate cost in cents for a given model and token usage.
 */
export function calcCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model] || { input: 300, output: 1500 };
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 100) / 100; // round to 2 decimal cents
}

/**
 * Log AI usage to the database. Fire-and-forget (doesn't block the response).
 */
export async function logAiUsage(opts: {
  userId?: string;
  endpoint: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  context?: string;
}): Promise<void> {
  try {
    const costCents = calcCostCents(opts.model, opts.inputTokens, opts.outputTokens);
    const supabase = await createClient();
    await supabase.from("ai_usage_logs").insert({
      user_id: opts.userId || null,
      endpoint: opts.endpoint,
      model: opts.model,
      input_tokens: opts.inputTokens,
      output_tokens: opts.outputTokens,
      cost_cents: Math.round(costCents * 100), // store as integer cents
      context: opts.context || null,
    });
  } catch {
    // Non-critical — don't block the response
  }
}

/**
 * Call Claude with automatic model fallback.
 */
export async function callClaude(
  system: string,
  userMessage: string,
  maxTokens: number = 4096
): Promise<string> {
  const anthropic = await getAnthropicClient();

  for (const model of CLAUDE_FALLBACK_MODELS) {
    try {
      const message = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userMessage }],
      });

      // Log usage
      if (message.usage) {
        logAiUsage({
          endpoint: "callClaude",
          model,
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        });
      }

      const content = message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
      if (content) return content;
    } catch {
      continue;
    }
  }

  throw new Error("All Claude models failed");
}
