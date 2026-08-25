import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyPhoneLineWatchers } from "@/lib/notifications/tagged-mentions";
import {
  formatPhone,
  getTwilioConfig,
  isAllowedNumber,
  publicRequestUrl,
  readTwilioParams,
  resolvePhoneContact,
  twimlResponse,
  validateTwilioSignature,
} from "@/lib/twilio/twilio";

export const dynamic = "force-dynamic";

/**
 * Twilio Messaging webhook ("A message comes in") for the field line.
 * Texts from allowlisted numbers (Luis) are stored and ping the watchers;
 * anything else is logged with is_allowed=false and silently dropped.
 * Never auto-replies — the team answers from /command-center/phone.
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
  const sid = params.MessageSid ?? params.SmsSid ?? "";
  if (!from || !sid) return twimlResponse("");

  // MMS photos ride along as [media] links appended to the body.
  let body = params.Body?.trim() ?? "";
  const numMedia = Number(params.NumMedia ?? "0") || 0;
  for (let i = 0; i < numMedia; i++) {
    const mediaUrl = params[`MediaUrl${i}`];
    if (mediaUrl) body = [body, `[media] ${mediaUrl}`].filter(Boolean).join("\n");
  }

  const allowed = isAllowedNumber(from, config);
  const contact = allowed ? await resolvePhoneContact(from) : null;

  const admin = createAdminClient();
  const { data: inserted, error } = await admin
    .from("sms_messages")
    .upsert(
      {
        twilio_sid: sid,
        direction: "inbound",
        from_number: from,
        to_number: to,
        body,
        status: allowed ? "received" : "ignored",
        contact_kind: contact?.kind ?? null,
        contact_id: contact?.id ?? null,
        contact_name: contact?.name ?? null,
        is_allowed: allowed,
      },
      { onConflict: "twilio_sid", ignoreDuplicates: true },
    )
    .select("id");

  if (error) {
    console.error("[twilio-sms] Could not store inbound message", {
      sid,
      error: error.message,
    });
  }

  // No row back = Twilio retried a message we already stored — don't re-ping.
  const row = inserted?.[0] as { id: string } | undefined;
  if (allowed && row) {
    const name = contact?.name ?? formatPhone(from);
    const preview = body || "(no text)";
    await notifyPhoneLineWatchers({
      kind: "sms",
      sourceId: row.id,
      title: `${name} texted: ${preview.slice(0, 120)}`.slice(0, 200),
      body: preview,
      actorProfileId: contact?.profileId ?? null,
      emailLead: `${name} texted the Penney phone line:`,
    }).catch((err) => {
      console.error("[twilio-sms] Notify failed", {
        sid,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return twimlResponse("");
}
