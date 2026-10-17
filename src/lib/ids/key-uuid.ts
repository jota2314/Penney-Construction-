import { createHash } from "node:crypto";

/**
 * A stable uuid for a text key: the same key always gives the same uuid.
 *
 * app_notifications.source_id is a NOT NULL uuid and the table is unique on
 * (recipient, source_type, source_id). Feeding it keyUuid("sub_field:{sub}:
 * {project}:{ET day}") makes "one notice per sub per job per day" a database
 * fact: a second insert that day is a duplicate the upsert ignores, even if
 * two requests race or a cron runs twice.
 *
 * RFC 4122 version 5 (SHA-1 of a namespace + the key), so it is a valid uuid
 * any library can check, and Python's uuid.uuid5(KEY_UUID_NAMESPACE, key)
 * gives the same answer. Server only (node:crypto).
 */

/** Penney's namespace for keyed ids. Never change it: every stored id derives from it. */
export const KEY_UUID_NAMESPACE = "5d0c7a3e-9b41-4f6e-8a2d-3c1f7e9b6a54";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidBytes(uuid: string): Buffer {
  if (!UUID_RE.test(uuid)) throw new Error(`keyUuid: namespace is not a uuid: ${uuid}`);
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

const DEFAULT_NAMESPACE_BYTES = uuidBytes(KEY_UUID_NAMESPACE);

/** keyUuid("sub_field:abc:def:2026-10-16") → "xxxxxxxx-xxxx-5xxx-yxxx-xxxxxxxxxxxx", always the same. */
export function keyUuid(key: string, namespace: string = KEY_UUID_NAMESPACE): string {
  const ns = namespace === KEY_UUID_NAMESPACE ? DEFAULT_NAMESPACE_BYTES : uuidBytes(namespace);
  const hash = createHash("sha1").update(ns).update(key, "utf8").digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
