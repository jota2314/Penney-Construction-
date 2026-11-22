import crypto from "crypto";

/**
 * Quo (formerly OpenPhone) signs every webhook delivery:
 *
 *   webhook-id         stable id of the delivery (same across retries)
 *   webhook-timestamp  Unix seconds when Quo signed it
 *   webhook-signature  one or more space-separated "v1,<base64>" entries
 *
 * The signature is HMAC-SHA256 over `{id}.{timestamp}.{raw body}` with the
 * webhook's signing key. The key is the `key` Quo returns when the webhook is
 * created: "whsec_" followed by the base64 of the secret bytes.
 *
 * No SDK, same as the Twilio line: one HMAC by hand. Verify the RAW body
 * before parsing it. Re-serialized JSON will not match.
 */

export const QUO_SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

export type QuoSignatureHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export type QuoSignatureResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no_key" | "missing_headers" | "stale_timestamp" | "bad_signature";
    };

function secretBytes(key: string): Buffer {
  const trimmed = key.trim();
  const base64 = trimmed.startsWith("whsec_")
    ? trimmed.slice("whsec_".length)
    : trimmed;
  return Buffer.from(base64, "base64");
}

/** The base64 signature Quo would send for this delivery and key. */
export function signQuoPayload(args: {
  key: string;
  id: string;
  timestamp: string;
  rawBody: string;
}): string {
  return crypto
    .createHmac("sha256", secretBytes(args.key))
    .update(`${args.id}.${args.timestamp}.${args.rawBody}`)
    .digest("base64");
}

/**
 * Accepts the delivery when any "v1" entry matches any configured key (more
 * than one key lets a webhook be re-created without dropping events).
 */
export function verifyQuoSignature(args: {
  keys: string[];
  rawBody: string;
  headers: QuoSignatureHeaders;
  nowSeconds?: number;
}): QuoSignatureResult {
  const keys = args.keys.map((key) => key.trim()).filter(Boolean);
  if (keys.length === 0) return { ok: false, reason: "no_key" };

  const { id, timestamp, signature } = args.headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: "missing_headers" };
  }

  const signedAt = Number(timestamp);
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(signedAt) ||
    Math.abs(now - signedAt) > QUO_SIGNATURE_MAX_AGE_SECONDS
  ) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const provided = signature
    .split(" ")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const comma = entry.indexOf(",");
      if (comma === -1) return null;
      return entry.slice(0, comma) === "v1" ? entry.slice(comma + 1) : null;
    })
    .filter((value): value is string => Boolean(value));

  const matches = keys.some((key) => {
    const expected = Buffer.from(
      signQuoPayload({ key, id, timestamp, rawBody: args.rawBody }),
    );
    return provided.some((candidate) => {
      const given = Buffer.from(candidate);
      return (
        given.length === expected.length &&
        crypto.timingSafeEqual(given, expected)
      );
    });
  });

  return matches ? { ok: true } : { ok: false, reason: "bad_signature" };
}
