import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getTwilioConfig,
  publicRequestUrl,
  readTwilioParams,
  validateTwilioSignature,
} from "@/lib/twilio/twilio";

export const dynamic = "force-dynamic";

/**
 * Twilio transcribeCallback — voicemail text is ready. Fills in the
 * transcript on the call row; the recording callback already notified,
 * so this stays silent. (Twilio transcription is English-only — Spanish
 * voicemails keep the audio as the source of truth.)
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
  const text = params.TranscriptionText?.trim() ?? "";
  const status = params.TranscriptionStatus ?? "";
  if (!callSid || status !== "completed" || !text) {
    return new Response("OK");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("phone_calls")
    .update({ transcript: text.slice(0, 10000) })
    .eq("twilio_call_sid", callSid);

  if (error) {
    console.error("[twilio-transcription] Could not store transcript", {
      callSid,
      error: error.message,
    });
  }

  return new Response("OK");
}
