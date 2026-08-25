import "server-only";

import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Twilio phone line for the field (the number repurposed from Boston
 * Builders AI). Config comes from Vercel env vars first, with app_settings
 * rows as a fallback that can be changed without a redeploy:
 *
 *   TWILIO_ACCOUNT_SID          / app_settings.twilio_account_sid
 *   TWILIO_AUTH_TOKEN           / app_settings.twilio_auth_token
 *   TWILIO_PHONE_NUMBER         / app_settings.twilio_phone_number
 *   TWILIO_ALLOWED_NUMBERS      / app_settings.twilio_allowed_numbers
 *   TWILIO_VOICE_FORWARD_NUMBER / app_settings.twilio_voice_forward_number
 *
 * TWILIO_ALLOWED_NUMBERS is a comma-separated list of the ONLY phones the
 * line talks to (currently: Luis). Inbound texts/calls from anyone else are
 * logged with is_allowed=false and never notified or answered, and outbound
 * sends to numbers off the list are refused.
 */

const SETTING_KEYS = [
  "twilio_account_sid",
  "twilio_auth_token",
  "twilio_phone_number",
  "twilio_allowed_numbers",
  "twilio_voice_forward_number",
] as const;

export type TwilioConfig = {
  accountSid: string | null;
  authToken: string | null;
  phoneNumber: string | null;
  allowedNumbers: string[];
  voiceForwardNumber: string | null;
};

export async function getTwilioConfig(): Promise<TwilioConfig> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", [...SETTING_KEYS]);

  const settings = new Map(
    ((data as { key: string; value: string | null }[] | null) ?? []).map(
      (row) => [row.key, row.value?.trim() || null],
    ),
  );

  const pick = (env: string | undefined, key: string): string | null =>
    env?.trim() || settings.get(key) || null;

  const allowedRaw = pick(
    process.env.TWILIO_ALLOWED_NUMBERS,
    "twilio_allowed_numbers",
  );

  return {
    accountSid: pick(process.env.TWILIO_ACCOUNT_SID, "twilio_account_sid"),
    authToken: pick(process.env.TWILIO_AUTH_TOKEN, "twilio_auth_token"),
    phoneNumber: pick(process.env.TWILIO_PHONE_NUMBER, "twilio_phone_number"),
    allowedNumbers: (allowedRaw ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean),
    voiceForwardNumber: pick(
      process.env.TWILIO_VOICE_FORWARD_NUMBER,
      "twilio_voice_forward_number",
    ),
  };
}

/** Last 10 digits — the only reliable way to compare US numbers across
 * +1/1/dashes/parens formatting (same trick the old BB SMS webhook used). */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function toE164(value: string): string {
  if (value.trim().startsWith("+")) return value.trim();
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function isAllowedNumber(number: string, config: TwilioConfig): boolean {
  const normalized = normalizePhone(number);
  if (!normalized) return false;
  return config.allowedNumbers.some((n) => normalizePhone(n) === normalized);
}

/** Pretty-print +19785551234 as (978) 555-1234 for the UI and notifications. */
export function formatPhone(value: string): string {
  const digits = normalizePhone(value);
  if (digits.length !== 10) return value;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Verify X-Twilio-Signature: HMAC-SHA1 over the exact public URL Twilio
 * requested plus the POST params concatenated key+value in sorted order.
 * The URL is rebuilt from forwarded headers because Vercel terminates TLS.
 */
export function validateTwilioSignature(args: {
  authToken: string;
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  const { authToken, signature, url, params } = args;
  if (!signature) return false;

  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");

  const expected = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The public URL of this request as Twilio saw it (behind Vercel's proxy). */
export function publicRequestUrl(req: Request): string {
  const url = new URL(req.url);
  const headers = req.headers;
  const proto = headers.get("x-forwarded-proto")?.split(",")[0] ?? "https";
  const host =
    headers.get("x-forwarded-host")?.split(",")[0] ??
    headers.get("host") ??
    url.host;
  return `${proto}://${host}${url.pathname}${url.search}`;
}

export function twimlResponse(inner: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`,
    { headers: { "Content-Type": "text/xml" } },
  );
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export type SendSmsResult =
  | { ok: true; sid: string }
  | { ok: false; error: string };

/** Send an SMS through the Twilio REST API (no SDK — one form POST). */
export async function sendTwilioSms(args: {
  config: TwilioConfig;
  to: string;
  body: string;
}): Promise<SendSmsResult> {
  const { config, to, body } = args;
  if (!config.accountSid || !config.authToken || !config.phoneNumber) {
    return { ok: false, error: "Twilio is not configured" };
  }

  const params = new URLSearchParams({
    From: toE164(config.phoneNumber),
    To: toE164(to),
    Body: body,
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    },
  );

  const json = (await res.json().catch(() => null)) as {
    sid?: string;
    message?: string;
  } | null;

  if (!res.ok || !json?.sid) {
    return {
      ok: false,
      error: json?.message ?? `Twilio send failed (HTTP ${res.status})`,
    };
  }
  return { ok: true, sid: json.sid };
}

export type PhoneContact = {
  kind: "employee" | "subcontractor";
  id: string;
  name: string;
  /** Linked app profile, when the number belongs to a teammate. */
  profileId: string | null;
} | null;

/**
 * Resolve a phone number to a teammate or sub so the thread shows a name.
 * Both tables are small; match on last-10 digits in JS like the picker does.
 */
export async function resolvePhoneContact(
  number: string,
): Promise<PhoneContact> {
  const normalized = normalizePhone(number);
  if (!normalized) return null;

  const admin = createAdminClient();
  const [employeesRes, subsRes] = await Promise.all([
    admin
      .from("employees")
      .select("id, first_name, last_name, phone, profile_id")
      .not("phone", "is", null),
    admin
      .from("subcontractors")
      .select("id, company_name, contact_name, phone")
      .not("phone", "is", null),
  ]);

  const employee = (
    (employeesRes.data as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      profile_id: string | null;
    }[] | null) ?? []
  ).find((row) => row.phone && normalizePhone(row.phone) === normalized);
  if (employee) {
    return {
      kind: "employee",
      id: employee.id,
      name:
        [employee.first_name, employee.last_name].filter(Boolean).join(" ") ||
        "Employee",
      profileId: employee.profile_id,
    };
  }

  const sub = (
    (subsRes.data as {
      id: string;
      company_name: string | null;
      contact_name: string | null;
      phone: string | null;
    }[] | null) ?? []
  ).find((row) => row.phone && normalizePhone(row.phone) === normalized);
  if (sub) {
    return {
      kind: "subcontractor",
      id: sub.id,
      name: sub.contact_name || sub.company_name || "Subcontractor",
      profileId: null,
    };
  }

  return null;
}

/**
 * The voicemail flow: short bilingual greeting, then record up to 2 minutes
 * (Twilio's transcription limit). The recording callback stores the audio
 * and pings the watchers; the transcription callback fills in the text.
 */
export function voicemailTwiml(): string {
  return (
    `<Say voice="Polly.Matthew">You reached the Penney Construction field line. Leave a message after the tone.</Say>` +
    `<Say voice="Polly.Miguel" language="es-MX">Deje su mensaje despu&#233;s del tono.</Say>` +
    `<Record maxLength="120" playBeep="true" transcribe="true" ` +
    `transcribeCallback="/api/twilio/transcription" ` +
    `recordingStatusCallback="/api/twilio/recording" ` +
    `action="/api/twilio/voice-after"/>`
  );
}

/** Params from a Twilio webhook, which POSTs form-encoded (or GET). */
export async function readTwilioParams(
  req: Request,
): Promise<Record<string, string>> {
  if (req.method === "GET") return {};
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });
  return params;
}
