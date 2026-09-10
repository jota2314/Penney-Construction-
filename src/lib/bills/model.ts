import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";
const MODEL_ATTEMPT_MS = 45_000;

/** Claude wraps JSON in prose or fences often enough to need both fallbacks. */
function jsonFromModel(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.substring(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function askClaude(
  content: Array<Record<string, unknown>>,
  maxTokens: number,
  deadline: number,
  stage: "reading" | "allocation" = "reading",
): Promise<Record<string, unknown> | null> {
  const anthropic = await getAnthropicClient();
  for (const model of CLAUDE_FALLBACK_MODELS) {
    const timeout = Math.min(MODEL_ATTEMPT_MS, deadline - Date.now());
    if (timeout < 1_000) break;
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: content as never }],
      }, { timeout, maxRetries: 0, signal: AbortSignal.timeout(timeout) });
      const text =
        response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
      if (text) {
        const parsed = jsonFromModel(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && response.stop_reason !== "max_tokens") return parsed;
      }
      console.warn("bill_scan_invalid_response", { stage, model, stopReason: response.stop_reason });
    } catch (error) {
      // Never log document contents, provider response bodies, or API keys.
      const failure = error as { name?: string; status?: number };
      console.warn("bill_scan_model_failed", {
        stage, model, type: failure?.name ?? "UnknownError", status: failure?.status,
      });
      continue;
    }
  }
  return null;
}
