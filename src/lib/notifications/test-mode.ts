import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * A safety valve for testing the bill flow without mailing the office.
 *
 * Filing a bill and approving it for pay both notify Nicole and Ryan (in-app,
 * push and email). That is right in production and wrong when Jorge is walking
 * the flow to see whether it works — they get a real "good to pay" email for a
 * bill nobody intends to pay.
 *
 * When `notifications_test_mode` is on in app_settings, every bill
 * notification is redirected to the tester alone and the subject is marked, so
 * the flow can be exercised end to end and the emails still inspected. It is a
 * DB row rather than an env var on purpose: flipping it needs no deploy, and
 * leaving it on is visible in one query.
 */

/** Who still receives bill notifications while test mode is on. */
export const TEST_MODE_RECIPIENT_EMAILS: readonly string[] = [
  "jbetancur@penneyconstructioninc.com",
];

const SETTING_KEY = "notifications_test_mode";
const ON_VALUES = new Set(["on", "true", "1", "yes"]);

/**
 * Read the switch. Defaults to OFF on any error or missing row — a settings
 * hiccup must never silently swallow a real approval email.
 */
export async function isNotificationTestMode(
  admin: ReturnType<typeof createAdminClient>,
): Promise<boolean> {
  try {
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", SETTING_KEY)
      .maybeSingle();
    const value = (data?.value ?? "").trim().toLowerCase();
    return ON_VALUES.has(value);
  } catch (err) {
    console.error("[notifications] test-mode lookup failed, assuming OFF", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Mark a subject/title so a test email is never mistaken for a real one. */
export function testModeSubject(subject: string): string {
  return `[TEST — do not action] ${subject}`.slice(0, 200);
}

/**
 * Narrow a recipient list to the tester. Applied AFTER the normal watcher
 * lookup so test mode can only ever REMOVE recipients, never add one.
 */
export function applyTestModeRecipients<T extends { email: string | null }>(
  recipients: T[],
  testMode: boolean,
): T[] {
  if (!testMode) return recipients;
  const allow = new Set(TEST_MODE_RECIPIENT_EMAILS);
  return recipients.filter((r) => r.email && allow.has(r.email.trim().toLowerCase()));
}
