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
  /** New messages left for the next run because the deadline arrived. */
  deferred?: number;
  /** The deadline arrived while listing, so new mail may not have been seen. */
  incomplete?: boolean;
}

// A caught-up mailbox may stop listing at its first fully stored page, but
// never goes longer than this without a full scan (see syncGmailForUser).
const FULL_SCAN_EVERY_MS = 60 * 60 * 1000;

// A classification started this close to the caller's deadline is skipped;
// classifyPendingInbound picks the email up on a later tick. A started call
// is capped at the time left, so it ends by the deadline.
const CLASSIFY_MIN_MS = 4_000;

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
  /**
   * Epoch ms after which no new Gmail call or message is started. The cron and
   * push webhook pass their soft budget so one mailbox can't run the function
   * into Vercel's 60 s kill (the 504s).
   */
  deadlineMs?: number;
}): Promise<SyncResult> {
  const { supabase, accessToken, userId, limit = 20, deadlineMs } = opts;
  const pastDeadline = () => deadlineMs !== undefined && Date.now() >= deadlineMs;

  // Stopping at the first fully stored page saves up to 9 Gmail list calls
  // per mailbox per run, but is only safe when nothing older is missing:
  //  - Runs drain newest-first, so a run that hit its limit, deferred or
  //    failed a message, or ran out of time leaves older unstored mail BELOW
  //    stored pages. Those runs set gmail_sync_backlog, and later runs page
  //    through like the old loop until one comes up clean.
  //  - Mail moved into the inbox later (rescued from Spam, unarchived) keeps
  //    its old date and also lands below stored pages, so a full scan still
  //    runs at least every FULL_SCAN_EVERY_MS (gmail_full_scan_at).
  // Unknown state (columns missing, read error) means a full scan.
  const { data: syncState, error: syncStateError } = await supabase
    .from("profiles")
    .select("gmail_sync_backlog, gmail_full_scan_at")
    .eq("id", userId)
    .maybeSingle();
  const hadBacklog = !!syncStateError || syncState?.gmail_sync_backlog !== false;
  const lastFullScanMs = syncState?.gmail_full_scan_at ? new Date(syncState.gmail_full_scan_at).getTime() : 0;
  const earlyStop =
    !hadBacklog && deadlineMs !== undefined && Date.now() - lastFullScanMs < FULL_SCAN_EVERY_MS;

  const newIds: string[] = [];
  let pageToken: string | undefined;
  let totalScanned = 0;
  let pagesListed = 0;
  let listingCut = false;
  let stoppedEarly = false;
  const MAX_PAGES = 10;

  const saveSyncState = async (backlog: boolean, fullScan: boolean) => {
    const update: Record<string, unknown> = {};
    if (backlog !== hadBacklog || syncStateError) update.gmail_sync_backlog = backlog;
    if (fullScan) update.gmail_full_scan_at = new Date().toISOString();
    if (Object.keys(update).length === 0) return;
    const { error } = await supabase.from("profiles").update(update).eq("id", userId);
    if (error) console.error(`[gmail-sync] sync state for ${userId} not saved:`, error.message);
  };

  for (let page = 0; page < MAX_PAGES && newIds.length < limit; page++) {
    if (pastDeadline()) {
      listingCut = true;
      break;
    }
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
    pagesListed += 1;
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
    const [{ data: existing }, { data: copies }] = await Promise.all([
      supabase.from("inbox_emails").select("gmail_message_id").in("gmail_message_id", pageIds),
      // This mailbox's copies of mail another mailbox already stored. Without
      // this they look new on every run and cost a Gmail fetch each time.
      supabase.from("inbox_email_mailbox_copies").select("gmail_message_id").in("gmail_message_id", pageIds),
    ]);
    const existingIds = new Set([
      ...(existing ?? []).map((e) => e.gmail_message_id),
      ...(copies ?? []).map((c) => c.gmail_message_id),
    ]);

    const newBefore = newIds.length;
    for (const m of messageIds) {
      if (!existingIds.has(m.id)) {
        newIds.push(m.id);
        if (newIds.length >= limit) break;
      }
    }
    // Caught-up mailbox, newest-first: a page where everything is already
    // stored means the older pages are too. Paging on cost up to 9 more
    // Gmail calls per mailbox per tick for nothing.
    if (earlyStop && newIds.length === newBefore) {
      stoppedEarly = true;
      break;
    }
    pageToken = listData.nextPageToken;
    if (!pageToken) break;
  }

  // A cut before the first page taught us nothing; leave the state alone.
  const learned = !(listingCut && pagesListed === 0);
  const fullScan = learned && !listingCut && !stoppedEarly && newIds.length < limit;
  const incomplete = listingCut ? { incomplete: true as const } : {};

  if (newIds.length === 0) {
    if (learned) await saveSyncState(listingCut, fullScan);
    return { stored: 0, scanned: totalScanned, errors: [], ...incomplete };
  }

  // Mark the backlog BEFORE processing when this run can't finish the job, so
  // a kill partway through (a 504) never leaves the flag saying "caught up".
  if (learned && (listingCut || newIds.length >= limit) && !hadBacklog) {
    await saveSyncState(true, false);
  }

  // Load classification context once for the batch (cached on Anthropic side)
  let classificationContext: ClassificationContext | null = null;
  try {
    classificationContext = await loadClassificationContext(supabase);
  } catch (err) {
    // Sync still proceeds; classifyPendingInbound catches these up later.
    console.error("[gmail-sync] classification context failed:", err instanceof Error ? err.message : String(err));
  }

  let stored = 0;
  let deferred = 0;
  const errors: string[] = [];

  for (const [index, id] of newIds.entries()) {
    if (pastDeadline()) {
      deferred = newIds.length - index;
      break;
    }
    try {
      const msgRes = await googleFetchWithToken(
        `${GMAIL_API}/users/me/messages/${id}?format=full`,
        accessToken
      );
      if (!msgRes.ok) {
        const detail = (await msgRes.text().catch(() => "")).slice(0, 200);
        errors.push(
          `Email ${id}: Gmail returned ${msgRes.status}${detail ? ` — ${detail}` : ""}`
        );
        continue;
      }
      const msg = await msgRes.json();
      // Attachment and Drive downloads below have no timeout of their own;
      // don't start them past the deadline. The id stays new for next run.
      if (pastDeadline()) {
        deferred = newIds.length - index;
        break;
      }

      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: { name: string; value: string }) =>
          h.name.toLowerCase() === name.toLowerCase()
        )?.value || "";

      const fromRaw = getHeader("From");
      const toRaw = getHeader("To");
      const subject = getHeader("Subject");
      const dateStr = getHeader("Date");
      // RFC822 Message-ID: stable across every mailbox the message touches.
      // Powers cross-account dedup (migration 00082) AND reply threading —
      // send_email's In-Reply-To header needs this value, not Gmail's short
      // per-account message id.
      const rfc822MessageId = getHeader("Message-ID").trim() || null;

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

      // Cross-account copy: another teammate's sync already stored this
      // exact RFC822 message under a different gmail_message_id. The unique
      // index from migration 00082 would reject the insert anyway — skip
      // here, before the expensive attachment download.
      if (rfc822MessageId) {
        const { data: dupe } = await supabase
          .from("inbox_emails")
          .select("id, gmail_message_id")
          .eq("rfc822_message_id", rfc822MessageId)
          .maybeSingle();
        // Same Gmail id means a concurrent run of THIS mailbox stored it.
        if (dupe && dupe.gmail_message_id === id) continue;
        if (dupe) {
          // Remember this mailbox's copy so the next run skips it without
          // calling Gmail, and so we know whose inbox it reached.
          const { error: copyError } = await supabase
            .from("inbox_email_mailbox_copies")
            .upsert(
              { gmail_message_id: id, inbox_email_id: dupe.id, profile_id: userId },
              { onConflict: "gmail_message_id", ignoreDuplicates: true }
            );
          if (copyError) console.error(`[gmail-sync] mailbox copy ${id} not recorded:`, copyError.message);
          continue;
        }
      }

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
          rfc822_message_id: rfc822MessageId,
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
        // 23505 here is the rfc822 unique index (gmail_message_id conflicts
        // are absorbed by ignoreDuplicates above): a concurrent sync from
        // another mailbox stored the same message between our dupe check
        // and this insert. The index doing its job — not a sync failure.
        if (insertError.code === "23505") continue;
        errors.push(`${subject}: ${insertError.message}`);
        continue;
      }
      // No row back means a concurrent sync (cron + push + manual can race)
      // already stored it. Skip silently — not an error, not a new store.
      if (!inserted) {
        continue;
      }
      stored++;

      // Classify (best effort — failures don't break sync). Near the deadline
      // leave it unclassified; classifyPendingInbound catches it up.
      const remainingMs = deadlineMs === undefined ? Infinity : deadlineMs - Date.now();
      if (inserted?.id && classificationContext && !isOutbound && remainingMs >= CLASSIFY_MIN_MS) {
        try {
          const result = await classifyEmail({
            email: {
              from_name: fromName,
              from_email: fromEmail,
              to_email: toEmail,
              subject: subject || "(no subject)",
              snippet: msg.snippet || "",
              body,
            },
            context: classificationContext,
            ...(deadlineMs === undefined
              ? {}
              : { timeoutMs: Math.min(15_000, remainingMs), maxRetries: 0 }),
          });
          await persistClassification(supabase, inserted.id, result, { linkProject: true });
        } catch (err) {
          // classification failure doesn't fail the sync
          console.error(`[gmail-sync] classify ${inserted.id} failed:`, err instanceof Error ? err.message : String(err));
        }
      }
    } catch (err) {
      errors.push(`Email ${id}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  // A failed message counts as left behind: clearing the flag now would let
  // the next run stop above it for good.
  if (learned) {
    await saveSyncState(
      listingCut || deferred > 0 || errors.length > 0 || newIds.length >= limit,
      fullScan
    );
  }
  return { stored, scanned: totalScanned, errors, ...(deferred > 0 ? { deferred } : {}), ...incomplete };
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
