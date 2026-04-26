/**
 * Core Gmail → inbox_emails sync logic.
 * Pure function — no cookie/session dependency. Both the user-driven
 * fetch route and the cron job call this.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { googleFetchWithToken } from "@/lib/google/server-auth";
import { COMPANY_EMAILS } from "@/lib/constants/company";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

export interface SyncResult {
  stored: number;
  scanned: number;
  errors: string[];
}

export async function syncGmailForUser(opts: {
  supabase: SupabaseClient;
  accessToken: string;
  userId: string;
  limit?: number;
}): Promise<SyncResult> {
  const { supabase, accessToken, userId, limit = 20 } = opts;

  const { data: existing } = await supabase
    .from("inbox_emails")
    .select("gmail_message_id");
  const existingIds = new Set((existing ?? []).map((e) => e.gmail_message_id));

  const newIds: string[] = [];
  let pageToken: string | undefined;
  let totalScanned = 0;
  const MAX_PAGES = 10;

  for (let page = 0; page < MAX_PAGES && newIds.length < limit; page++) {
    let url = `${GMAIL_API}/users/me/messages?maxResults=50&q=${encodeURIComponent("in:inbox OR in:sent")}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const listRes = await googleFetchWithToken(url, accessToken);
    if (!listRes.ok) throw new Error("Failed to list Gmail messages");
    const listData = await listRes.json();
    const messageIds: { id: string }[] = listData.messages || [];
    if (messageIds.length === 0) break;
    totalScanned += messageIds.length;

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

      const isOutbound = COMPANY_EMAILS.some(
        (ce) => fromEmail.toLowerCase() === ce.toLowerCase()
      );

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

      const { error: insertError } = await supabase.from("inbox_emails").insert({
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
      });

      if (insertError) {
        errors.push(`${subject}: ${insertError.message}`);
      } else {
        stored++;
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
  supabase: SupabaseClient,
  accessToken: string
): Promise<{ filename: string; mimeType: string; size: number; storage_path: string | null }[]> {
  const results: { filename: string; mimeType: string; size: number; storage_path: string | null }[] = [];
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
        const gMime = meta.mimeType as string;
        const name = (meta.name as string) || fileId;

        let exportMime: string | null = null;
        let extension = "";
        if (gMime === "application/vnd.google-apps.document") { exportMime = "application/pdf"; extension = ".pdf"; }
        else if (gMime === "application/vnd.google-apps.spreadsheet") { exportMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; extension = ".xlsx"; }
        else if (gMime === "application/vnd.google-apps.presentation") { exportMime = "application/pdf"; extension = ".pdf"; }

        let fileData: ArrayBuffer | null = null;
        let finalMime = gMime;
        let finalName = name;

        if (exportMime) {
          const exportRes = await googleFetchWithToken(
            `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`,
            accessToken
          );
          if (exportRes.ok) {
            fileData = await exportRes.arrayBuffer();
            finalMime = exportMime;
            if (!name.toLowerCase().endsWith(extension)) finalName = name + extension;
          }
        } else {
          const dlRes = await googleFetchWithToken(
            `${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`,
            accessToken
          );
          if (dlRes.ok) fileData = await dlRes.arrayBuffer();
        }

        if (fileData) {
          const safeName = finalName.replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = `${messageId}/${safeName}`;
          const bytes = new Uint8Array(fileData);
          const { error: uploadError } = await supabase.storage
            .from("email-attachments")
            .upload(path, bytes, { contentType: finalMime, upsert: true });
          results.push({
            filename: finalName,
            mimeType: finalMime,
            size: bytes.length,
            storage_path: uploadError ? null : path,
          });
        }
      } catch {
        // skip this drive file
      }
    }
  }

  return results;
}
