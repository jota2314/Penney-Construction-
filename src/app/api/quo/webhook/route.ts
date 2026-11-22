import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseQuoEnvelope } from "@/lib/quo/events";
import { ingestQuoEvent } from "@/lib/quo/ingest";
import { verifyQuoSignature } from "@/lib/quo/signature";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Quo (formerly OpenPhone) -> here. One endpoint for every event the webhook
 * is subscribed to: texts in and out, finished calls, and the recording,
 * AI summary, transcript and voicemail that follow a call.
 *
 * Security:
 *  - Public (middleware never redirects /api/*), so every delivery must carry
 *    a valid signature made with the webhook's signing key (QUO_WEBHOOK_KEY,
 *    the `whsec_...` value Quo returns when the webhook is created). Several
 *    keys can be listed comma-separated while a webhook is being replaced.
 *  - The body is verified raw, before it is parsed. Text and transcripts are
 *    stored as data and never executed or sent to AI here.
 *
 * Responses (Quo retries every non-2xx for about 27 hours):
 *  - 503 not configured, 401 bad signature.
 *  - 200 for anything we stored or chose to ignore.
 *  - 500 when the database write failed, so Quo sends it again. Rows are
 *    keyed on Quo's id, which makes a repeat harmless.
 */
function webhookKeys(): string[] {
  return (process.env.QUO_WEBHOOK_KEY ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

export async function POST(request: Request) {
  const keys = webhookKeys();
  if (keys.length === 0) {
    return NextResponse.json({ error: "Quo is not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const check = verifyQuoSignature({
    keys,
    rawBody,
    headers: {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
  });
  if (!check.ok) {
    console.warn("[quo-webhook] rejected delivery:", check.reason);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = parseQuoEnvelope(rawBody);
  if (!event) {
    // Signed by Quo but not a shape we know. Ack so it is not retried.
    return NextResponse.json({ ok: true, skipped: "unparseable" });
  }

  try {
    const result = await ingestQuoEvent(createAdminClient(), event);
    return NextResponse.json({ ok: true, type: event.type, ...result });
  } catch (err) {
    console.error("[quo-webhook] could not store event", {
      type: event.type,
      deliveryId: request.headers.get("webhook-id"),
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not store event" }, { status: 500 });
  }
}
