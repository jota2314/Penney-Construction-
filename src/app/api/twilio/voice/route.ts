import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  escapeXml,
  getTwilioConfig,
  isAllowedNumber,
  publicRequestUrl,
  readTwilioParams,
  resolvePhoneContact,
  toE164,
  twimlResponse,
  validateTwilioSignature,
  voicemailTwiml,
} from "@/lib/twilio/twilio";

export const dynamic = "force-dynamic";

/**
 * Twilio Voice webhook ("A call comes in") for the field line.
 * Allowlisted callers (Luis) either ring through to the forward number
 * (TWILIO_VOICE_FORWARD_NUMBER, optional) or land in voicemail with
 * recording + transcription. Everyone else is rejected.
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

  const from = params.From ?? "";
  const to = params.To ?? "";
  const callSid = params.CallSid ?? "";
  if (!from || !callSid) return twimlResponse("<Hangup/>");

  const allowed = isAllowedNumber(from, config);
  const contact = allowed ? await resolvePhoneContact(from) : null;
  const forwarding = allowed && Boolean(config.voiceForwardNumber);

  const admin = createAdminClient();
  const { error } = await admin.from("phone_calls").upsert(
    {
      twilio_call_sid: callSid,
      direction: "inbound",
      from_number: from,
      to_number: to,
      status: allowed ? (forwarding ? "forwarded" : "voicemail") : "rejected",
      contact_kind: contact?.kind ?? null,
      contact_id: contact?.id ?? null,
      contact_name: contact?.name ?? null,
      is_allowed: allowed,
    },
    { onConflict: "twilio_call_sid", ignoreDuplicates: true },
  );
  if (error) {
    console.error("[twilio-voice] Could not store call", {
      callSid,
      error: error.message,
    });
  }

  if (!allowed) return twimlResponse("<Reject/>");

  if (forwarding && config.voiceForwardNumber) {
    // Caller ID passes through, so the phone that rings shows Luis's number.
    // No answer within 20s → /api/twilio/voice-after drops to voicemail.
    return twimlResponse(
      `<Dial timeout="20" action="/api/twilio/voice-after">` +
        `<Number>${escapeXml(toE164(config.voiceForwardNumber))}</Number>` +
        `</Dial>`,
    );
  }

  return twimlResponse(voicemailTwiml());
}
