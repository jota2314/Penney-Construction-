/**
 * Gmail rate-limit guard. When Google returns 429, we persist the
 * retry-after timestamp on the user's profile and refuse to call any
 * Gmail endpoint until that time has passed. This stops accidental
 * retries from re-arming Google's rolling throttle window.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export class GmailRateLimitError extends Error {
  readonly retryAfterMs: number;
  readonly retryAt: Date;
  readonly reason: string | null;
  constructor(retryAfterMs: number, reason: string | null) {
    const seconds = Math.ceil(retryAfterMs / 1000);
    const retryAt = new Date(Date.now() + retryAfterMs);
    super(`Gmail rate limit (${reason ?? "rate-limited"}). Retry in ~${seconds}s (at ${retryAt.toISOString()}).`);
    this.name = "GmailRateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.retryAt = retryAt;
    this.reason = reason;
  }
}

/**
 * If the user is currently throttled, throw GmailRateLimitError without
 * touching Gmail. Call this at the top of any code path that's about to
 * hit the Gmail API.
 */
export async function assertGmailNotThrottled(
  supabase: Pick<SupabaseClient, "from">,
  userId: string
): Promise<void> {
  const { data } = await supabase
    .from("profiles")
    .select("gmail_throttled_until")
    .eq("id", userId)
    .maybeSingle();
  const until = data?.gmail_throttled_until ? new Date(data.gmail_throttled_until) : null;
  if (until && until.getTime() > Date.now()) {
    const remainingMs = until.getTime() - Date.now();
    throw new GmailRateLimitError(remainingMs, "cooling-down");
  }
}

/**
 * Persist the retry-until timestamp so subsequent attempts are blocked
 * locally instead of being sent to Google (which would re-arm the
 * throttle). Best-effort — log on failure but don't throw.
 */
export async function recordGmailThrottle(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
  retryAfterMs: number
): Promise<void> {
  const until = new Date(Date.now() + retryAfterMs).toISOString();
  try {
    await supabase
      .from("profiles")
      .update({ gmail_throttled_until: until })
      .eq("id", userId);
  } catch (err) {
    console.error(
      `[gmail-throttle] failed to record throttle for ${userId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Server-side send rate limit. Conservative caps that stay well under
 * Google's adaptive anti-abuse thresholds, so accidental bursts (AI
 * batching, frustrated re-taps, runaway workflow loops) cannot cross the
 * line. Throws RateLimitExceeded which the caller surfaces to the UI.
 */
export class RateLimitExceeded extends Error {
  readonly window: string;
  readonly limit: number;
  constructor(window: string, limit: number) {
    super(`Send rate limit exceeded: ${limit} per ${window}. Wait a bit and try again.`);
    this.name = "RateLimitExceeded";
    this.window = window;
    this.limit = limit;
  }
}

const RATE_LIMITS = [
  { window: "10s",   intervalSec: 10,    max: 1   },
  { window: "1min",  intervalSec: 60,    max: 3   },
  { window: "1hour", intervalSec: 3600,  max: 30  },
  { window: "1day",  intervalSec: 86400, max: 150 },
];

export async function assertSendRateOk(
  supabase: Pick<SupabaseClient, "from">,
  userId: string
): Promise<void> {
  const since = new Date(Date.now() - RATE_LIMITS[RATE_LIMITS.length - 1].intervalSec * 1000).toISOString();
  const { data: rows } = await supabase
    .from("gmail_send_attempts")
    .select("attempted_at")
    .eq("user_id", userId)
    .gte("attempted_at", since);
  const timestamps = (rows ?? []).map((r) => new Date(r.attempted_at).getTime());
  const now = Date.now();
  for (const limit of RATE_LIMITS) {
    const cutoff = now - limit.intervalSec * 1000;
    const count = timestamps.filter((t) => t >= cutoff).length;
    if (count >= limit.max) throw new RateLimitExceeded(limit.window, limit.max);
  }
}

export async function recordSendAttempt(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
  toEmail: string,
  succeeded: boolean
): Promise<void> {
  try {
    await supabase.from("gmail_send_attempts").insert({
      user_id: userId,
      to_email: toEmail,
      succeeded,
    });
  } catch { /* non-critical */ }
}
