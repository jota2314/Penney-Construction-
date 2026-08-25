"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  formatPhone,
  getTwilioConfig,
  isAllowedNumber,
  resolvePhoneContact,
  sendTwilioSms,
  toE164,
} from "@/lib/twilio/twilio";

export type PhoneThreadItem = {
  id: string;
  type: "sms" | "call";
  direction: "inbound" | "outbound";
  /** The non-Penney side of the exchange (E.164-ish, as Twilio sent it). */
  counterpartyNumber: string;
  counterpartyName: string;
  body: string | null;
  /** sms: received|sent|failed · call: received|forwarded|voicemail */
  status: string;
  errorMessage: string | null;
  transcript: string | null;
  hasRecording: boolean;
  recordingDuration: number | null;
  sentByName: string | null;
  createdAt: string;
};

export type PhoneLineData = {
  configured: boolean;
  /** The Twilio number, formatted for display. */
  phoneNumber: string | null;
  /** Allowlisted counterparties with resolved names (currently: Luis). */
  allowedContacts: { number: string; name: string }[];
  forwardingEnabled: boolean;
  items: PhoneThreadItem[];
};

type SmsRow = {
  id: string;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  body: string;
  status: string;
  error_message: string | null;
  contact_name: string | null;
  created_at: string;
  sender: { full_name: string | null } | { full_name: string | null }[] | null;
};

type CallRow = {
  id: string;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  status: string;
  transcript: string | null;
  recording_sid: string | null;
  recording_duration: number | null;
  contact_name: string | null;
  created_at: string;
};

export async function getPhoneLineData(): Promise<PhoneLineData> {
  const config = await getTwilioConfig();
  const configured = Boolean(
    config.accountSid && config.authToken && config.phoneNumber,
  );

  // Reads go through the cookie client — the RLS select policy covers them.
  const supabase = await createClient();
  const [smsRes, callsRes, allowedContacts] = await Promise.all([
    supabase
      .from("sms_messages")
      .select(
        "id, direction, from_number, to_number, body, status, error_message, contact_name, created_at, sender:profiles!sent_by_profile_id(full_name)",
      )
      .eq("is_allowed", true)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("phone_calls")
      .select(
        "id, direction, from_number, to_number, status, transcript, recording_sid, recording_duration, contact_name, created_at",
      )
      .eq("is_allowed", true)
      .order("created_at", { ascending: false })
      .limit(100),
    Promise.all(
      config.allowedNumbers.map(async (number) => {
        const contact = await resolvePhoneContact(number);
        return {
          number: toE164(number),
          name: contact?.name ?? formatPhone(number),
        };
      }),
    ),
  ]);

  const smsItems: PhoneThreadItem[] = (
    (smsRes.data as SmsRow[] | null) ?? []
  ).map((row) => {
    const sender = Array.isArray(row.sender) ? row.sender[0] : row.sender;
    const counterparty =
      row.direction === "inbound" ? row.from_number : row.to_number;
    return {
      id: row.id,
      type: "sms",
      direction: row.direction,
      counterpartyNumber: counterparty,
      counterpartyName: row.contact_name ?? formatPhone(counterparty),
      body: row.body,
      status: row.status,
      errorMessage: row.error_message,
      transcript: null,
      hasRecording: false,
      recordingDuration: null,
      sentByName: sender?.full_name ?? null,
      createdAt: row.created_at,
    };
  });

  const callItems: PhoneThreadItem[] = (
    (callsRes.data as CallRow[] | null) ?? []
  ).map((row) => {
    const counterparty =
      row.direction === "inbound" ? row.from_number : row.to_number;
    return {
      id: row.id,
      type: "call",
      direction: row.direction,
      counterpartyNumber: counterparty,
      counterpartyName: row.contact_name ?? formatPhone(counterparty),
      body: null,
      status: row.status,
      errorMessage: null,
      transcript: row.transcript,
      hasRecording: Boolean(row.recording_sid),
      recordingDuration: row.recording_duration,
      sentByName: null,
      createdAt: row.created_at,
    };
  });

  const items = [...smsItems, ...callItems].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return {
    configured,
    phoneNumber: config.phoneNumber ? formatPhone(config.phoneNumber) : null,
    allowedContacts,
    forwardingEnabled: Boolean(config.voiceForwardNumber),
    items,
  };
}

export type SendPhoneSmsResult = { ok: true } | { ok: false; error: string };

export async function sendPhoneLineSms(input: {
  to: string;
  body: string;
}): Promise<SendPhoneSmsResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const body = input.body.trim();
  if (!body) return { ok: false, error: "Type a message first" };
  if (body.length > 1200) {
    return { ok: false, error: "Message is too long (1,200 characters max)" };
  }

  const config = await getTwilioConfig();
  if (!config.accountSid || !config.authToken || !config.phoneNumber) {
    return { ok: false, error: "The phone line isn't configured yet" };
  }
  // The line only talks to allowlisted numbers — same rule as inbound.
  if (!isAllowedNumber(input.to, config)) {
    return { ok: false, error: "That number isn't on the phone-line allowlist" };
  }

  const result = await sendTwilioSms({ config, to: input.to, body });
  const contact = await resolvePhoneContact(input.to);

  const admin = createAdminClient();
  const { error: insertError } = await admin.from("sms_messages").insert({
    twilio_sid: result.ok ? result.sid : null,
    direction: "outbound",
    from_number: toE164(config.phoneNumber),
    to_number: toE164(input.to),
    body,
    status: result.ok ? "sent" : "failed",
    error_message: result.ok ? null : result.error,
    contact_kind: contact?.kind ?? null,
    contact_id: contact?.id ?? null,
    contact_name: contact?.name ?? null,
    sent_by_profile_id: user.profile?.id ?? user.id,
    is_allowed: true,
  });
  if (insertError) {
    console.error("[phone-line] Could not log outbound SMS", {
      error: insertError.message,
    });
  }

  revalidatePath("/command-center/phone");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
