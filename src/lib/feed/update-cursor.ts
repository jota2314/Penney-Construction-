export type UpdateSource = "daily_log" | "company_post" | "punch_group";
export type UpdateKey = { source: UpdateSource; source_id: string; occurred_at: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function isUpdateId(id: unknown): boolean {
  return typeof id === "string" && UUID.test(id);
}

export function isUpdateKey(value: unknown): value is UpdateKey {
  if (!value || typeof value !== "object") return false;
  const key = value as UpdateKey;
  return ["daily_log", "company_post", "punch_group"].includes(key.source) &&
    (isUpdateId(key.source_id) || (key.source === "punch_group" &&
      typeof key.source_id === "string" && key.source_id.startsWith("solo-") && isUpdateId(key.source_id.slice(5)))) &&
    typeof key.occurred_at === "string" && TIMESTAMP.test(key.occurred_at) &&
    Number.isFinite(Date.parse(key.occurred_at)) &&
    // Validate the calendar without changing the six-digit database precision.
    new Date(key.occurred_at).toISOString().slice(0, 19) === key.occurred_at.slice(0, 19);
}

export function encodeUpdateCursor(key: UpdateKey): string {
  return Buffer.from(JSON.stringify({ v: 1, ...key })).toString("base64url");
}

export function decodeUpdateCursor(cursor: string | null): UpdateKey | null {
  if (cursor === null) return null;
  if (typeof cursor !== "string" || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new Error("Invalid updates cursor. Refresh and try again.");
  }
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (value.v !== 1 || !isUpdateKey(value)) throw new Error("Invalid cursor");
    return { source: value.source, source_id: value.source_id, occurred_at: value.occurred_at };
  } catch {
    throw new Error("Invalid updates cursor. Refresh and try again.");
  }
}
