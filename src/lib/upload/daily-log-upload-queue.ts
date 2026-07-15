"use client";

/**
 * In-memory background upload queue for daily-log photos.
 *
 * Why this exists: posting a daily log with 20 photos used to require
 * the user to keep the composer sheet open until every byte finished
 * uploading. With this queue, the post() flow:
 *
 *   1. Inserts the daily_log row immediately (text + zero photos).
 *   2. Closes the sheet.
 *   3. Pushes every photo onto this queue.
 *   4. The queue shrinks each photo, uploads it through our own
 *      same-origin API (/api/crew/daily-log-photo), and the server
 *      appends the storage path atomically as each one completes.
 *
 * The same-origin + compress combo is the proven upload path:
 * multi-MB phone photos over a direct cross-origin storage upload are
 * exactly what stalls on weak job-site signal, and the old client-side
 * "read paths, write paths+1" append raced against itself when several
 * photos finished at once (photos vanished from the log). The server
 * now appends via the append_daily_log_photo() SQL function under the
 * row lock, so parallel uploads can't clobber each other.
 *
 * Backgrounding caveat: because this lives in the browser tab, photos
 * that haven't started uploading yet WILL be cancelled if the user
 * fully kills the app. Photos already in flight usually complete
 * because iOS lets in-progress fetches finish for a few seconds after
 * backgrounding. A future iteration should move this to a Service
 * Worker with Background Sync for true cross-launch durability.
 *
 * The queue is a singleton kept on globalThis so it survives across
 * React renders and route navigations.
 */

import { compressImage } from "@/lib/image/compress";

const MAX_CONCURRENT = 3;
const UPLOAD_TIMEOUT_MS = 45000;

interface QueueItem {
  logId: string;
  file: File;
  attempts: number;
}

interface Queue {
  pending: QueueItem[];
  inFlight: number;
  listeners: Set<(state: QueueState) => void>;
}

export interface QueueState {
  pending: number;
  inFlight: number;
  total: number;
  completed: number;
  failed: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __pcDailyLogUploadQueue: Queue | undefined;
  // eslint-disable-next-line no-var
  var __pcDailyLogUploadCompleted: number | undefined;
  // eslint-disable-next-line no-var
  var __pcDailyLogUploadTotal: number | undefined;
  // eslint-disable-next-line no-var
  var __pcDailyLogUploadFailed: number | undefined;
}

function getQueue(): Queue {
  if (!globalThis.__pcDailyLogUploadQueue) {
    globalThis.__pcDailyLogUploadQueue = {
      pending: [],
      inFlight: 0,
      listeners: new Set(),
    };
    globalThis.__pcDailyLogUploadCompleted = 0;
    globalThis.__pcDailyLogUploadTotal = 0;
    globalThis.__pcDailyLogUploadFailed = 0;
  }
  return globalThis.__pcDailyLogUploadQueue;
}

function notify() {
  const q = getQueue();
  const state: QueueState = {
    pending: q.pending.length,
    inFlight: q.inFlight,
    total: globalThis.__pcDailyLogUploadTotal ?? 0,
    completed: globalThis.__pcDailyLogUploadCompleted ?? 0,
    failed: globalThis.__pcDailyLogUploadFailed ?? 0,
  };
  q.listeners.forEach((fn) => fn(state));
}

/**
 * Shrink + upload one photo through the same-origin API. The server
 * stores the file and appends its path to the log atomically.
 */
async function processOne(item: QueueItem): Promise<void> {
  let body: Blob = item.file;
  try {
    body = await compressImage(item.file);
  } catch {
    // Couldn't decode/shrink (e.g. HEIC the browser can't render) —
    // send the original and let the server store it as-is.
  }

  const fd = new FormData();
  fd.append("logId", item.logId);
  fd.append("file", body, "photo.jpg");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch("/api/crew/daily-log-photo", {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Upload failed (${res.status})`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function pump() {
  const q = getQueue();
  while (q.inFlight < MAX_CONCURRENT && q.pending.length > 0) {
    const item = q.pending.shift()!;
    q.inFlight++;
    notify();
    processOne(item)
      .then(() => {
        globalThis.__pcDailyLogUploadCompleted = (globalThis.__pcDailyLogUploadCompleted ?? 0) + 1;
      })
      .catch((err) => {
        console.error("[upload-queue] photo failed:", err);
        // Retry up to 2 times for transient network errors.
        if (item.attempts < 2) {
          q.pending.push({ ...item, attempts: item.attempts + 1 });
        } else {
          // Surrender — surface it as failed instead of pretending it made it.
          globalThis.__pcDailyLogUploadFailed = (globalThis.__pcDailyLogUploadFailed ?? 0) + 1;
        }
      })
      .finally(() => {
        q.inFlight--;
        notify();
        pump();
      });
  }
  if (q.pending.length === 0 && q.inFlight === 0) {
    // Reset counters when fully drained so the next post starts clean.
    // Leave failures on screen longer so the user actually sees them.
    const failed = globalThis.__pcDailyLogUploadFailed ?? 0;
    setTimeout(() => {
      if (q.pending.length === 0 && q.inFlight === 0) {
        globalThis.__pcDailyLogUploadCompleted = 0;
        globalThis.__pcDailyLogUploadTotal = 0;
        globalThis.__pcDailyLogUploadFailed = 0;
        notify();
      }
    }, failed > 0 ? 8000 : 1500);
  }
}

export function enqueueDailyLogPhotos(logId: string, files: File[]): void {
  const q = getQueue();
  q.pending.push(...files.map((file) => ({ logId, file, attempts: 0 })));
  globalThis.__pcDailyLogUploadTotal = (globalThis.__pcDailyLogUploadTotal ?? 0) + files.length;
  notify();
  pump();
}

export function subscribeUploadQueue(listener: (state: QueueState) => void): () => void {
  const q = getQueue();
  q.listeners.add(listener);
  // Push initial state so the subscriber renders immediately.
  notify();
  return () => { q.listeners.delete(listener); };
}
