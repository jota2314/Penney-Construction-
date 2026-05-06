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
