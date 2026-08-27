import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";

/**
 * One honest JSON call to Claude, shared by the receipt/bill scanners.
 *
 * It replaces the copy-pasted `askClaude()` both scan routes carried, whose
 * `catch { continue }` swallowed EVERY failure — auth, 429, overload, timeout,
 * a truncated answer — and returned a bare `null`. Both routes then told the
 * user their photo was bad. On 8/26 that hid a real outage for a full day:
 * 17 uploads by 5 people, every one of them answered "try a clearer photo",
 * nothing logged anywhere, nothing to debug from.
 *
 * So: every failure is logged AND described. The caller gets a reason it can
 * put in front of the user, and an HTTP status that says whether retrying is
 * worth anything.
 */

export type AskFailureKind =
  | "no_key"
  | "out_of_credit"
  | "rate_limited"
  | "unavailable"
  | "timed_out"
  | "rejected"
  | "truncated"
  | "unparseable";

export type AskFailure = {
  kind: AskFailureKind;
  /** Sentence for the user. Never blames the file unless the file is at fault. */
  message: string;
  /** The technical truth — model, HTTP status, API message. Shown as fine print. */
  detail: string;
  /** 503 when it is our side / the API's side, 422 when the document really is the problem. */
  status: number;
};

export type AskJsonResult =
  | { ok: true; data: Record<string, unknown>; model: string }
  | { ok: false; failure: AskFailure };

/** Claude wraps JSON in prose or fences often enough to need both fallbacks. */
export function jsonFromModel(raw: string): Record<string, unknown> | null {
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

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/** Total wall-clock we allow across every model and retry (route cap is 60s). */
const BUDGET_MS = 42_000;
/** Ceiling for any single request, so one hung call can't eat the budget. */
const PER_CALL_MS = 25_000;

type ApiErrorish = {
  status?: number;
  message?: string;
  request_id?: string;
  name?: string;
  error?: { error?: { type?: string; message?: string } };
};

function describe(err: unknown): { status: number | null; type: string; message: string; requestId: string } {
  const e = (err ?? {}) as ApiErrorish;
  return {
    status: typeof e.status === "number" ? e.status : null,
    type: e.error?.error?.type ?? e.name ?? "unknown_error",
    message: e.error?.error?.message ?? e.message ?? String(err),
    requestId: e.request_id ?? "-",
  };
}

function failureFor(
  status: number | null,
  type: string,
  message: string,
  model: string,
  requestId: string,
): AskFailure {
  const detail = `${model} → ${status ?? "no status"} ${type}: ${message}${
    requestId !== "-" ? ` (req ${requestId})` : ""
  }`;

  if (status === 429)
    return {
      kind: "rate_limited",
      message: "The AI reader is rate-limited right now. Wait a minute and try again — nothing was lost.",
      detail,
      status: 503,
    };
  if (status === 401 || status === 403)
    return {
      kind: "rejected",
      message: "The AI reader rejected our API key. This needs Jorge — the file is fine.",
      detail,
      status: 503,
    };
  // The 8/26 outage in one branch: a dry credit balance comes back as a 400,
  // which otherwise reads as "bad document" and sends people back to re-shoot
  // a receipt that was always fine.
  if (/credit balance|billing|quota|insufficient/i.test(message))
    return {
      kind: "out_of_credit",
      message: "The AI account is out of credit — nothing is wrong with your file. Jorge has to top it up.",
      detail,
      status: 503,
    };
  if (status === 400 || status === 413)
    return {
      kind: "rejected",
      message: "The AI reader refused this document — it may be too large or an unsupported format.",
      detail,
      status: 422,
    };
  if (status !== null && RETRYABLE.has(status))
    return {
      kind: "unavailable",
      message: "The AI reader is having a moment. Try again in a minute — nothing was lost.",
      detail,
      status: 503,
    };
  return {
    kind: "unavailable",
    message: "Could not reach the AI reader. Try again in a minute — nothing was lost.",
    detail,
    status: 503,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function askClaudeJson(
  content: Array<Record<string, unknown>>,
  maxTokens: number,
  label: string,
): Promise<AskJsonResult> {
  let anthropic;
  try {
    anthropic = await getAnthropicClient();
  } catch (err) {
    const d = describe(err);
    console.error(`[ai:${label}] no client`, d);
    return {
      ok: false,
      failure: {
        kind: "no_key",
        message: "The AI reader is not configured. This needs Jorge — the file is fine.",
        detail: d.message,
        status: 503,
      },
    };
  }

  const startedAt = Date.now();
  const left = () => BUDGET_MS - (Date.now() - startedAt);
  let lastFailure: AskFailure | null = null;

  for (const model of CLAUDE_FALLBACK_MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (left() <= 2_000) {
        const detail = `gave up after ${Math.round((Date.now() - startedAt) / 1000)}s${
          lastFailure ? ` — last: ${lastFailure.detail}` : ""
        }`;
        console.error(`[ai:${label}] out of time`, detail);
        return {
          ok: false,
          failure: {
            kind: "timed_out",
            message: "The AI reader took too long. Try again — nothing was lost.",
            detail,
            status: 503,
          },
        };
      }

      try {
        const response = await anthropic.messages.create(
          {
            model,
            max_tokens: maxTokens,
            messages: [{ role: "user", content: content as never }],
          },
          { timeout: Math.min(PER_CALL_MS, left()), maxRetries: 0 },
        );

        const text =
          response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
        const parsed = text ? jsonFromModel(text) : null;
        if (parsed) return { ok: true, data: parsed, model };

        // An answer we could not use. Truncation is its own diagnosis: the
        // read ran out of room, which no amount of re-photographing fixes.
        if (response.stop_reason === "max_tokens") {
          lastFailure = {
            kind: "truncated",
            message:
              "The read got cut off — that document is longer than one pass. Try the page with the totals on it.",
            detail: `${model} → stop_reason=max_tokens at ${maxTokens} tokens, ${text.length} chars returned`,
            status: 422,
          };
        } else {
          lastFailure = {
            kind: "unparseable",
            message: "The AI answered in a form we could not read. Try again.",
            detail: `${model} → stop_reason=${response.stop_reason ?? "none"}, ${
              text.length
            } chars, not JSON: ${text.slice(0, 200)}`,
            status: 422,
          };
        }
        console.error(`[ai:${label}] ${lastFailure.kind}`, lastFailure.detail);
        break; // a usable connection but a bad answer — next model, not a retry
      } catch (err) {
        const d = describe(err);
        lastFailure = failureFor(d.status, d.type, d.message, model, d.requestId);
        console.error(`[ai:${label}] attempt ${attempt} failed`, lastFailure.detail);
        const retryable = d.status === null || RETRYABLE.has(d.status);
        if (!retryable) break; // 400/401/403 will fail identically on a retry
        if (attempt === 1 && left() > 6_000) await sleep(1_200);
      }
    }
  }

  return {
    ok: false,
    failure:
      lastFailure ?? {
        kind: "unavailable",
        message: "Could not reach the AI reader. Try again in a minute — nothing was lost.",
        detail: "no model attempt produced a result",
        status: 503,
      },
  };
}
