import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getTwilioConfig,
  publicRequestUrl,
  readTwilioParams,
  twimlResponse,
  validateTwilioSignature,
  voicemailTwiml,
} from "@/lib/twilio/twilio";

export const dynamic = "force-dynamic";

/**
 * Continuation webhook for the voice flow. Twilio calls it in two cases:
 * - after <Dial> (DialCallStatus set): answered → hang up; missed → voicemail
 * - after <Record> (RecordingUrl/Duration set): confirm and hang up
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

  const dialStatus = params.DialCallStatus;
  if (dialStatus) {
    if (dialStatus === "completed") return twimlResponse("<Hangup/>");

    // Missed/busy/failed forward — record a voicemail instead.
    const callSid = params.CallSid;
    if (callSid) {
      const admin = createAdminClient();
      await admin
        .from("phone_calls")
        .update({ status: "voicemail" })
        .eq("twilio_call_sid", callSid);
    }
    return twimlResponse(voicemailTwiml());
  }

  // Post-<Record> (caller pressed # or hit the time limit).
  if (params.RecordingUrl || params.RecordingDuration) {
    return twimlResponse(
      `<Say voice="Polly.Matthew">Got it. Thanks.</Say><Hangup/>`,
    );
  }

  return twimlResponse("<Hangup/>");
}
