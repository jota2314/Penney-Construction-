import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyPhoneLineWatchers } from "@/lib/notifications/tagged-mentions";
import {
  formatPhone,
  getTwilioConfig,
  publicRequestUrl,
  readTwilioParams,
  resolvePhoneContact,
  validateTwilioSignature,
} from "@/lib/twilio/twilio";

export const dynamic = "force-dynamic";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Twilio recordingStatusCallback — the voicemail audio is ready.
 * Stores the recording on the call row and pings the watchers once
 * (the transcription callback fills in the text later, silently).
 */
export async function POST(req: NextRequest) {
  const config = await getTwilioConfig();
  if (!config.authToken) {
    return new Response("Twilio not configured", { status: 503 });
  }

  const params = await readTwilioParams(req);
  const valid = validateTwilioSignature({
    authToken: config.authToken,
    signature: req.headers.get("x-twilio-signature"),
    url: publicRequestUrl(req),
    params,
  });
  if (!valid) return new Response("Invalid signature", { status: 403 });

  const callSid = params.CallSid ?? "";
  const recordingSid = params.RecordingSid ?? "";
  const recordingUrl = params.RecordingUrl ?? "";
  const duration = Number(params.RecordingDuration ?? "0") || 0;
  const status = params.RecordingStatus ?? "completed";
  if (!callSid || !recordingSid || status !== "completed") {
    return new Response("OK");
  }

  // The .is("recording_sid", null) guard makes Twilio retries a no-op —
  // the second attempt updates zero rows and never re-pings anyone.
  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("phone_calls")
    .update({
      recording_sid: recordingSid,
      recording_url: recordingUrl,
      recording_duration: duration,
      status: "voicemail",
    })
    .eq("twilio_call_sid", callSid)
    .is("recording_sid", null)
    .select("id, from_number, contact_name, is_allowed");

  if (error) {
    console.error("[twilio-recording] Could not store recording", {
      callSid,
      error: error.message,
    });
  }

  const row = updated?.[0] as
    | { id: string; from_number: string; contact_name: string | null; is_allowed: boolean }
    | undefined;

  if (row?.is_allowed) {
    const contact = await resolvePhoneContact(row.from_number);
    const name = row.contact_name ?? contact?.name ?? formatPhone(row.from_number);
    await notifyPhoneLineWatchers({
      kind: "call",
      sourceId: row.id,
      title: `Voicemail from ${name} (${formatDuration(duration)})`.slice(0, 200),
      body: `${name} left a ${formatDuration(duration)} voicemail on the Penney phone line. Listen and read the transcript in the app.`,
      actorProfileId: contact?.profileId ?? null,
      emailLead: `${name} left a voicemail on the Penney phone line:`,
    }).catch((err) => {
      console.error("[twilio-recording] Notify failed", {
        callSid,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return new Response("OK");
}
