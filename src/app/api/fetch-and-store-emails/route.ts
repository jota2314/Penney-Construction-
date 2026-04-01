import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleFetch } from "@/lib/google/auth";
import { COMPANY_EMAILS } from "@/lib/constants/company";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { limit = 20 } = await request.json().catch(() => ({}));

    // 1. Get all existing Gmail message IDs from our DB
    const { data: existing } = await supabase
      .from("inbox_emails")
      .select("gmail_message_id");
    const existingIds = new Set((existing ?? []).map((e) => e.gmail_message_id));

    // 2. Paginate through Gmail until we find enough NEW emails
    const newIds: string[] = [];
    let pageToken: string | undefined;
    let totalScanned = 0;
    const MAX_PAGES = 10; // Safety limit — don't scan forever

    for (let page = 0; page < MAX_PAGES && newIds.length < limit; page++) {
      let url = `${GMAIL_API}/users/me/messages?maxResults=50&q=${encodeURIComponent("in:inbox OR in:sent")}`;
      if (pageToken) url += `&pageToken=${pageToken}`;

      const listRes = await googleFetch(url);
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
      if (!pageToken) break; // No more pages
    }

    if (newIds.length === 0) {
      return NextResponse.json({
        stored: 0,
        skipped: totalScanned,
        message: `Scanned ${totalScanned} emails — all already stored`,
      });
    }

    // 3. Fetch full content for each new email
    let stored = 0;
    const errors: string[] = [];

    for (const id of newIds) {
      try {
        // Fetch full message
        const msgRes = await googleFetch(`${GMAIL_API}/users/me/messages/${id}?format=full`);
        if (!msgRes.ok) continue;
        const msg = await msgRes.json();

        // Parse headers
        const headers = msg.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h: { name: string; value: string }) =>
            h.name.toLowerCase() === name.toLowerCase()
          )?.value || "";

        const fromRaw = getHeader("From");
        const toRaw = getHeader("To");
        const subject = getHeader("Subject");
        const dateStr = getHeader("Date");

        // Parse from/to
        const fromMatch = fromRaw.match(/(?:"?([^"]*)"?\s+)?<?([^>]+@[^>]+)>?/);
        const fromName = fromMatch?.[1]?.trim() || fromRaw;
        const fromEmail = fromMatch?.[2]?.trim() || fromRaw;

        const toMatch = toRaw.match(/(?:"?([^"]*)"?\s+)?<?([^>]+@[^>]+)>?/);
        const toName = toMatch?.[1]?.trim() || toRaw;
        const toEmail = toMatch?.[2]?.trim() || toRaw;

        const isOutbound = COMPANY_EMAILS.some(
          (ce) => fromEmail.toLowerCase() === ce.toLowerCase()
        );

        // Extract body
        const body = extractBody(msg.payload);

        // Extract and download attachments
        const attachments = await extractAndStoreAttachments(
          id, msg.payload, supabase
        );

        // Also extract Google Docs/Sheets linked in the email body
        const driveAttachments = await extractDriveLinks(id, body, supabase);
        attachments.push(...driveAttachments);

        // Parse date
        let emailDate: string;
        try {
          emailDate = new Date(dateStr).toISOString();
        } catch {
          emailDate = new Date(parseInt(msg.internalDate)).toISOString();
        }

        // 4. Store in Supabase
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
          body: body.substring(0, 50000), // cap at 50k chars
          snippet: msg.snippet || body.substring(0, 300),
          attachments: attachments,
          labels: msg.labelIds || [],
          is_processed: false,
          created_by: user.id,
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

    return NextResponse.json({
      stored,
      skipped: totalScanned - newIds.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Stored ${stored} new emails (scanned ${totalScanned}, skipped ${totalScanned - newIds.length} duplicates)${errors.length > 0 ? `, ${errors.length} errors` : ""}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// ── Extract plain text body from MIME structure ──────────

// ── PATCH: dismiss/restore emails ────────────────────────
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { emailId, is_dismissed } = await request.json();
  if (!emailId) return NextResponse.json({ error: "emailId required" }, { status: 400 });

  const { error } = await supabase
    .from("inbox_emails")
    .update({ is_dismissed: !!is_dismissed })
    .eq("id", emailId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

function extractBody(payload: Record<string, unknown>): string {
  if (!payload) return "";

  // Direct body
  const body = payload.body as { data?: string; size: number } | undefined;
  if (body?.data) {
    return decodeBase64Url(body.data);
  }

  // Multipart — look for text/plain first, then text/html
  const parts = payload.parts as Record<string, unknown>[] | undefined;
  if (!parts) return "";

  // Try text/plain
  for (const part of parts) {
    if (part.mimeType === "text/plain") {
      const partBody = part.body as { data?: string } | undefined;
      if (partBody?.data) return decodeBase64Url(partBody.data);
    }
  }

  // Try text/html — keep the HTML so it renders properly
  for (const part of parts) {
    if (part.mimeType === "text/html") {
      const partBody = part.body as { data?: string } | undefined;
      if (partBody?.data) {
        return decodeBase64Url(partBody.data);
      }
    }
  }

  // Recurse into nested parts
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
    try {
      return atob(base64);
    } catch {
      return "";
    }
  }
}

// ── Extract and store attachments ──────────

async function extractAndStoreAttachments(
  messageId: string,
  payload: Record<string, unknown>,
  supabase: Awaited<ReturnType<typeof createClient>>
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
        // Download attachment from Gmail
        const attRes = await googleFetch(
          `${GMAIL_API}/users/me/messages/${messageId}/attachments/${partBody.attachmentId}`
        );
        if (attRes.ok) {
          const attData = await attRes.json();
          if (attData.data) {
            // Convert base64url to regular base64
            const base64 = attData.data.replace(/-/g, "+").replace(/_/g, "/");
            const binaryStr = atob(base64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }

            // Upload to Supabase storage
            const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
            const path = `${messageId}/${safeName}`;

            const { error: uploadError } = await supabase.storage
              .from("email-attachments")
              .upload(path, bytes, { contentType: mimeType, upsert: true });

            if (!uploadError) {
              storagePath = path;
            }
          }
        }
      } catch {
        // Attachment download failed — store metadata without file
      }

      attachments.push({
        filename,
        mimeType,
        size: partBody.size || 0,
        storage_path: storagePath,
      });
    }

    // Recurse into nested parts
    if (part.parts) {
      const nested = await extractAndStoreAttachments(messageId, part, supabase);
      attachments.push(...nested);
    }
  }

  return attachments;
}

// ── Extract Google Docs/Sheets links from email body and export them ──

const DRIVE_LINK_PATTERNS = [
  // docs.google.com/document/d/{fileId}
  /https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/g,
  // docs.google.com/spreadsheets/d/{fileId}
  /https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/g,
  // drive.google.com/file/d/{fileId}
  /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/g,
  // drive.google.com/open?id={fileId}
  /https?:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/g,
];

const DRIVE_API = "https://www.googleapis.com/drive/v3";

async function extractDriveLinks(
  messageId: string,
  body: string,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ filename: string; mimeType: string; size: number; storage_path: string | null }[]> {
  const results: { filename: string; mimeType: string; size: number; storage_path: string | null }[] = [];
  const seenIds = new Set<string>();

  for (const pattern of DRIVE_LINK_PATTERNS) {
    // Reset regex state for each pattern
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(body)) !== null) {
      const fileId = match[1];
      if (seenIds.has(fileId)) continue;
      seenIds.add(fileId);

      try {
        // Get file metadata
        const metaRes = await googleFetch(
          `${DRIVE_API}/files/${fileId}?fields=name,mimeType,size&supportsAllDrives=true`
        );
        if (!metaRes.ok) continue;
        const meta = await metaRes.json();

        const gMime = meta.mimeType as string;
        const name = (meta.name as string) || fileId;

        // Determine export format
        let exportMime: string | null = null;
        let extension = "";
        if (gMime === "application/vnd.google-apps.document") {
          exportMime = "application/pdf";
          extension = ".pdf";
        } else if (gMime === "application/vnd.google-apps.spreadsheet") {
          exportMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          extension = ".xlsx";
        } else if (gMime === "application/vnd.google-apps.presentation") {
          exportMime = "application/pdf";
          extension = ".pdf";
        } else {
          // Regular Drive file — download directly
          exportMime = null;
        }

        let fileData: ArrayBuffer | null = null;
        let finalMime = gMime;
        let finalName = name;

        if (exportMime) {
          // Export Google Workspace file
          const exportRes = await googleFetch(
            `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`
          );
          if (exportRes.ok) {
            fileData = await exportRes.arrayBuffer();
            finalMime = exportMime;
            // Add extension if not already present
            if (!name.toLowerCase().endsWith(extension)) {
              finalName = name + extension;
            }
          }
        } else {
          // Download regular file
          const dlRes = await googleFetch(
            `${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`
          );
          if (dlRes.ok) {
            fileData = await dlRes.arrayBuffer();
          }
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
        // Skip this Drive file if anything fails
      }
    }
  }

  return results;
}
