/**
 * Core Gmail → inbox_emails sync logic.
 * Pure function — no cookie/session dependency. Both the user-driven
 * fetch route and the cron job call this.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { googleFetchWithToken } from "@/lib/google/server-auth";
import { GmailRateLimitError } from "@/lib/google/throttle";
import { classifyEmail, persistClassification, loadClassificationContext, type ClassificationContext } from "./classify";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

export interface SyncResult {
  stored: number;
  scanned: number;
  errors: string[];
}

function parseRetryAfterMs(headerVal: string | null, body: string): number {
  if (headerVal) {
    const seconds = Number(headerVal);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const asDate = Date.parse(headerVal);
    if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  }
  const match = body.match(/Retry after (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  if (match) {
    const t = Date.parse(match[1]);
    if (!Number.isNaN(t)) return Math.max(0, t - Date.now());
  }
  return 60_000;
}

export async function syncGmailForUser(opts: {
  supabase: SupabaseClient;
  accessToken: string;
  userId: string;
  limit?: number;
}): Promise<SyncResult> {
  const { supabase, accessToken, userId, limit = 20 } = opts;

  const newIds: string[] = [];
  let pageToken: string | undefined;
  let totalScanned = 0;
  const MAX_PAGES = 10;

  for (let page = 0; page < MAX_PAGES && newIds.length < limit; page++) {
    let url = `${GMAIL_API}/users/me/messages?maxResults=50&q=${encodeURIComponent("in:inbox OR in:sent")}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const listRes = await googleFetchWithToken(url, accessToken);
    if (!listRes.ok) {
      const body = await listRes.text().catch(() => "<no body>");
      // 429 — surface the retry timestamp so the caller can persist it
      // on the user's profile and stop further calls from re-arming the
      // throttle. Previously this route swallowed the 429 silently,
      // which meant the Sync button kept hitting Gmail every tap.
      if (listRes.status === 429) {
        const retryAfterMs = parseRetryAfterMs(listRes.headers.get("retry-after"), body);
        console.error(
          `[gmail-sync] 429 throttle for user ${userId} — retry in ${Math.ceil(retryAfterMs / 1000)}s — body=${body}`
        );
        throw new GmailRateLimitError(retryAfterMs, "rateLimitExceeded");
      }
      throw new Error(
        `Gmail messages.list failed: HTTP ${listRes.status} ${listRes.statusText} — ${body.slice(0, 500)}`
      );
    }
    const listData = await listRes.json();
    const messageIds: { id: string }[] = listData.messages || [];
    if (messageIds.length === 0) break;
    totalScanned += messageIds.length;

    // Find which of THIS page's messages are already stored. Scoping the
    // lookup to the page's ids keeps us under PostgREST's 1000-row select
    // cap. Previously we selected every stored gmail_message_id up front,
    // but with thousands of rows that set was silently truncated to 1000,
    // so recent messages looked "new", got re-inserted, and tripped the
    // gmail_message_id unique constraint on every sync — which also starved
    // the batch so genuinely new mail never got ingested.
    const pageIds = messageIds.map((m) => m.id);
    const { data: existing } = await supabase
      .from("inbox_emails")
      .select("gmail_message_id")
      .in("gmail_message_id", pageIds);
    const existingIds = new Set((existing ?? []).map((e) => e.gmail_message_id));

    for (const m of messageIds) {
      if (!existingIds.has(m.id)) {
        newIds.push(m.id);
        if (newIds.length >= limit) break;
      }
    }
    pageToken = listData.nextPageToken;
    if (!pageToken) break;
  }

  if (newIds.length === 0) {
    return { stored: 0, scanned: totalScanned, errors: [] };
  }

  // Load classification context once for the batch (cached on Anthropic side)
  let classificationContext: ClassificationContext | null = null;
  try {
    classificationContext = await loadClassificationContext(supabase);
  } catch {
    // If context load fails, sync still proceeds without classification
  }

  let stored = 0;
  const errors: string[] = [];

  for (const id of newIds) {
    try {
      const msgRes = await googleFetchWithToken(
        `${GMAIL_API}/users/me/messages/${id}?format=full`,
        accessToken
      );
      if (!msgRes.ok) continue;
      const msg = await msgRes.json();

      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: { name: string; value: string }) =>
          h.name.toLowerCase() === name.toLowerCase()
        )?.value || "";

      const fromRaw = getHeader("From");
      const toRaw = getHeader("To");
      const subject = getHeader("Subject");
      const dateStr = getHeader("Date");

      const fromMatch = fromRaw.match(/(?:"?([^"]*)"?\s+)?<?([^>]+@[^>]+)>?/);
      const fromName = fromMatch?.[1]?.trim() || fromRaw;
      const fromEmail = fromMatch?.[2]?.trim() || fromRaw;
      const toMatch = toRaw.match(/(?:"?([^"]*)"?\s+)?<?([^>]+@[^>]+)>?/);
      const toName = toMatch?.[1]?.trim() || toRaw;
      const toEmail = toMatch?.[2]?.trim() || toRaw;

      // Direction is per-user, derived from Gmail labels.
      // Gmail tags messages YOU sent with the SENT label in YOUR account.
      // Anything else lands in your inbox = inbound, even when from a coworker.
      const labels: string[] = msg.labelIds || [];
      const isOutbound = labels.includes("SENT");

      const body = extractBody(msg.payload);
      const attachments = await extractAndStoreAttachments(id, msg.payload, supabase, accessToken);
      const driveAttachments = await extractDriveLinks(id, body, supabase, accessToken);
      attachments.push(...driveAttachments);

      let emailDate: string;
      try {
        emailDate = new Date(dateStr).toISOString();
      } catch {
        emailDate = new Date(parseInt(msg.internalDate)).toISOString();
      }

      const { data: inserted, error: insertError } = await supabase
        .from("inbox_emails")
        .upsert({
          gmail_message_id: id,
          thread_id: msg.threadId || null,
          subject: subject || "(no subject)",
          from_name: fromName,
          from_email: fromEmail,
          to_name: toName,
          to_email: toEmail,
          date: emailDate,
          direction: isOutbound ? "outbound" : "inbound",
          body: body.substring(0, 50000),
          snippet: msg.snippet || body.substring(0, 300),
          attachments,
          labels: msg.labelIds || [],
          is_processed: false,
          created_by: userId,
          // Outbound emails are pre-marked so the push-notification
          // cron skips them. Inbound emails stay null until the cron
          // picks them up and sends a push.
          notified_at: isOutbound ? new Date().toISOString() : null,
        }, { onConflict: "gmail_message_id", ignoreDuplicates: true })
        .select("id")
        .maybeSingle();

      if (insertError) {
        errors.push(`${subject}: ${insertError.message}`);
        continue;
      }
      // No row back means a concurrent sync (cron + push + manual can race)
      // already stored it. Skip silently — not an error, not a new store.
      if (!inserted) {
        continue;
      }
      stored++;

      // Classify (best effort — failures don't break sync)
      if (inserted?.id && classificationContext && !isOutbound) {
        try {
          const result = await classifyEmail({
            email: {
              from_name: fromName,
              from_email: fromEmail,
              subject: subject || "(no subject)",
              snippet: msg.snippet || "",
              body: body.substring(0, 1500),
            },
            context: classificationContext,
          });
          await persistClassification(supabase, inserted.id, result);
        } catch {
          // classification failure doesn't fail the sync
        }
      }
    } catch (err) {
      errors.push(`Email ${id}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return { stored, scanned: totalScanned, errors };
}

function extractBody(payload: Record<string, unknown>): string {
  if (!payload) return "";
  const body = payload.body as { data?: string; size: number } | undefined;
  if (body?.data) return decodeBase64Url(body.data);

  const parts = payload.parts as Record<string, unknown>[] | undefined;
  if (!parts) return "";

  for (const part of parts) {
    if (part.mimeType === "text/plain") {
      const partBody = part.body as { data?: string } | undefined;
      if (partBody?.data) return decodeBase64Url(partBody.data);
    }
  }
  for (const part of parts) {
    if (part.mimeType === "text/html") {
      const partBody = part.body as { data?: string } | undefined;
      if (partBody?.data) return decodeBase64Url(partBody.data);
    }
  }
  for (const part of parts) {
    const nested = extractBody(part);
    if (nested) return nested;
  }
  return "";
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
  } catch {
    try { return atob(base64); } catch { return ""; }
  }
}

async function extractAndStoreAttachments(
  messageId: string,
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
  accessToken: string
): Promise<{ filename: string; mimeType: string; size: number; storage_path: string | null }[]> {
  const attachments: { filename: string; mimeType: string; size: number; storage_path: string | null }[] = [];
  const parts = payload.parts as Record<string, unknown>[] | undefined;
  if (!parts) return attachments;

  for (const part of parts) {
    const filename = part.filename as string;
    const mimeType = part.mimeType as string;
    const partBody = part.body as { attachmentId?: string; size?: number } | undefined;

    if (filename && partBody?.attachmentId) {
      let storagePath: string | null = null;
      try {
        const attRes = await googleFetchWithToken(
          `${GMAIL_API}/users/me/messages/${messageId}/attachments/${partBody.attachmentId}`,
          accessToken
        );
        if (attRes.ok) {
          const attData = await attRes.json();
          if (attData.data) {
            const base64 = attData.data.replace(/-/g, "+").replace(/_/g, "/");
            const binaryStr = atob(base64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

            const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
            const path = `${messageId}/${safeName}`;
            const { error: uploadError } = await supabase.storage
              .from("email-attachments")
              .upload(path, bytes, { contentType: mimeType, upsert: true });
            if (!uploadError) storagePath = path;
          }
        }
      } catch {
        // attachment download failed
      }

      attachments.push({ filename, mimeType, size: partBody.size || 0, storage_path: storagePath });
    }

    if (part.parts) {
      const nested = await extractAndStoreAttachments(messageId, part, supabase, accessToken);
      attachments.push(...nested);
    }
  }

  return attachments;
}

const DRIVE_LINK_PATTERNS = [
  /https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/g,
  /https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/g,
  /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/g,
  /https?:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/g,
];

async function extractDriveLinks(
  messageId: string,
  body: string,
  _supabase: SupabaseClient,
  accessToken: string
): Promise<{ filename: string; mimeType: string; size: number; storage_path: string | null; drive_file_id?: string }[]> {
  // Only fetch lightweight metadata (name, mimeType, size) for each Drive
  // link found in the body — DO NOT download the file content during sync.
  // Content gets fetched on demand when the user opens the email or asks
  // the AI to extract text from it. This was the single biggest source of
  // background API pressure: pre-2026-05-07 each email triggered up to
  // megabyte-scale Drive downloads (Doc → PDF export, Sheet → XLSX, etc.).
  // Storing only the drive_file_id keeps every code path that needs the
  // bytes (email-chat extraction, send-with-attachment) able to fetch
  // them when actually needed.
  const results: { filename: string; mimeType: string; size: number; storage_path: string | null; drive_file_id: string }[] = [];
  const seenIds = new Set<string>();

  for (const pattern of DRIVE_LINK_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(body)) !== null) {
      const fileId = match[1];
      if (seenIds.has(fileId)) continue;
      seenIds.add(fileId);

      try {
        const metaRes = await googleFetchWithToken(
          `${DRIVE_API}/files/${fileId}?fields=name,mimeType,size&supportsAllDrives=true`,
          accessToken
        );
        if (!metaRes.ok) continue;
        const meta = await metaRes.json();
        const gMime = (meta.mimeType as string) || "application/octet-stream";
        const name = (meta.name as string) || fileId;
        const size = Number(meta.size) || 0;

        // Map Google-native types to a sensible filename extension so the
        // UI can display the right icon. Actual export/download happens
        // on demand, not here.
        let displayName = name;
        if (gMime === "application/vnd.google-apps.document" && !name.endsWith(".pdf")) displayName = name + ".pdf";
        else if (gMime === "application/vnd.google-apps.spreadsheet" && !name.endsWith(".xlsx")) displayName = name + ".xlsx";
        else if (gMime === "application/vnd.google-apps.presentation" && !name.endsWith(".pdf")) displayName = name + ".pdf";

        results.push({
          filename: displayName,
          mimeType: gMime,
          size,
          storage_path: null,    // intentionally not downloaded
          drive_file_id: fileId, // resolves on demand via Drive API
        });
      } catch {
        // skip this drive file
      }
    }
  }

  return results;
}
