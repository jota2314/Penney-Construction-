"use client";

/**
 * Persistent background upload queue for daily-log photos.
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
 * Files and stable upload IDs are committed to IndexedDB before the
 * composer closes. Opening the app restores unfinished uploads; failures
 * remain available for retry. Uploading still needs the app and a connection.
 *
 * The active queue is a singleton across React renders and route changes.
 */

import { compressImage } from "@/lib/image/compress";
import { savePhotos, loadPhotos, removePhoto, type SavedPhoto } from "./persisted-photos";

const MAX_CONCURRENT = 3;
/** Per-photo cap. A ~700 KB JPEG on a 2-bar job-site uplink can legitimately
 * take over a minute, and the old 45 s cap aborted every photo in a batch of
 * three at once. */
const UPLOAD_TIMEOUT_MS = 120000;
/** Tries per photo before the queue parks it (it still auto-retries later). */
const MAX_ATTEMPTS = 6;
/** Backoff between tries so a flaky connection gets room to recover. */
const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000];
/** While anything is parked as failed, poke the queue this often. */
const PARKED_RETRY_MS = 60000;

interface QueueItem extends SavedPhoto {
  attempts: number;
  /** false when IndexedDB refused the blob — upload straight from memory. */
  persisted: boolean;
}

interface Queue {
  pending: QueueItem[];
  inFlight: number;
  listeners: Set<(state: QueueState) => void>;
  knownIds: Set<string>;
  failedItems: QueueItem[];
  restore?: Promise<void>;
  recoveryError?: string;
  /** Weak-signal mode: after a timeout/network failure, upload one photo at
   * a time until something succeeds, so three parallel uploads can't starve
   * each other into all timing out. */
  serial: boolean;
  parkedTimer?: ReturnType<typeof setTimeout>;
  listenersBound?: boolean;
}

export interface QueueState {
  pending: number;
  inFlight: number;
  total: number;
  completed: number;
  failed: number;
  recoveryError?: string;
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
      knownIds: new Set(),
      failedItems: [],
      serial: false,
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
    recoveryError: q.recoveryError,
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
    body = await compressImage(new File([item.file], "photo.jpg", { type: item.file.type }));
  } catch {
    // Couldn't decode/shrink (e.g. HEIC the browser can't render) —
    // send the original and let the server store it as-is.
  }

  const fd = new FormData();
  fd.append("logId", item.logId);
  fd.append("uploadId", item.id);
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
      const err = new Error(data?.error || `Upload failed (${res.status})`);
      // 4xx is the server rejecting this photo (bad log, signed out) — a
      // retry will not change that. 5xx/timeouts are worth retrying.
      (err as Error & { permanent?: boolean }).permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
      throw err;
    }
  } finally {
    clearTimeout(timeout);
  }
}

function isPermanent(err: unknown): boolean {
  return Boolean((err as { permanent?: boolean } | null)?.permanent);
}

function retryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

function scheduleParkedRetry() {
  const q = getQueue();
  if (q.parkedTimer || q.failedItems.length === 0) return;
  q.parkedTimer = setTimeout(() => {
    q.parkedTimer = undefined;
    if (typeof navigator !== "undefined" && navigator.onLine === false) { scheduleParkedRetry(); return; }
    void retryPhotoUploads();
  }, PARKED_RETRY_MS);
}

/** Wake the queue whenever the phone comes back online or the app returns
 * to the foreground — a worker who posts, then switches to Messages, gets
 * their uploads resumed the moment they come back. */
function bindWakeListeners() {
  const q = getQueue();
  if (q.listenersBound || typeof window === "undefined") return;
  q.listenersBound = true;
  const wake = () => { void retryPhotoUploads(); };
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wake(); });
  window.addEventListener("pageshow", wake);
}

function pump() {
  const q = getQueue();
  const limit = q.serial ? 1 : MAX_CONCURRENT;
  while (q.inFlight < limit && q.pending.length > 0) {
    const item = q.pending.shift()!;
    q.inFlight++;
    notify();
    processOne(item)
      .then(async () => {
        // The photo is on the server; a stale device copy is harmless, so a
        // failed IndexedDB delete must never count as an upload failure.
        if (item.persisted) await removePhoto(item.id).catch(() => {});
        q.knownIds.delete(item.id);
        q.serial = false;
        globalThis.__pcDailyLogUploadCompleted = (globalThis.__pcDailyLogUploadCompleted ?? 0) + 1;
        if (typeof window !== "undefined") window.dispatchEvent(new Event("daily-log-photo-saved"));
      })
      .catch((err) => {
        console.error("[upload-queue] photo failed:", err);
        const attempts = item.attempts + 1;
        if (!isPermanent(err) && attempts < MAX_ATTEMPTS) {
          // Timeouts and dropped connections: go one-at-a-time and back off.
          q.serial = true;
          setTimeout(() => {
            q.pending.push({ ...item, attempts });
            notify();
            pump();
          }, retryDelay(item.attempts));
        } else {
          // Park it. It stays on the device and is retried on reconnect,
          // on foreground, on a timer, and when the user taps Retry.
          globalThis.__pcDailyLogUploadFailed = (globalThis.__pcDailyLogUploadFailed ?? 0) + 1;
          q.failedItems.push({ ...item, attempts: 0 });
          scheduleParkedRetry();
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
    if (failed > 0) return; // Retain recoverable failures until retry succeeds.
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

async function restoreQueue(): Promise<void> {
  const q = getQueue();
  if (!q.restore) {
    q.restore = loadPhotos().then(photos => {
      q.recoveryError = undefined;
      for (const photo of photos) {
        if (q.knownIds.has(photo.id)) continue;
        q.knownIds.add(photo.id);
        q.pending.push({ ...photo, attempts: 0, persisted: true });
        globalThis.__pcDailyLogUploadTotal = (globalThis.__pcDailyLogUploadTotal ?? 0) + 1;
      }
      notify();
      pump();
    }).catch(error => {
      q.restore = undefined;
      q.recoveryError = "Could not recover pending photos on this device. Retry with the app open.";
      notify();
      throw error;
    });
  }
  await q.restore;
}

export async function retryPhotoUploads(): Promise<void> {
  const q = getQueue();
  if (q.parkedTimer) { clearTimeout(q.parkedTimer); q.parkedTimer = undefined; }
  q.pending.push(...q.failedItems.splice(0).map(item => ({ ...item, attempts: 0 })));
  globalThis.__pcDailyLogUploadFailed = 0;
  await restoreQueue().catch(() => {});
  notify();
  pump();
}

export type EnqueueResult = {
  /** false when the device refused to keep a copy: uploads still run, but
   * only while this page stays open. */
  persisted: boolean;
};

export async function enqueueDailyLogPhotos(logId: string, files: File[]): Promise<EnqueueResult> {
  bindWakeListeners();
  await restoreQueue().catch(() => {});
  const q = getQueue();
  const saved = files.map(file => ({ id: crypto.randomUUID(), logId, file }));
  // Commit blobs to device storage before dismissing the composer. If the
  // browser refuses (IndexedDB quota, private mode, a Chrome-on-Android blob
  // hiccup), upload from memory anyway — the old behaviour threw here and
  // the photos never left the phone at all.
  let persisted = true;
  try {
    await savePhotos(saved);
  } catch (err) {
    console.error("[upload-queue] could not persist photos, uploading from memory:", err);
    persisted = false;
  }
  const items: QueueItem[] = saved.map(item => ({ ...item, attempts: 0, persisted }));
  for (const item of items) q.knownIds.add(item.id);
  q.pending.push(...items);
  globalThis.__pcDailyLogUploadTotal = (globalThis.__pcDailyLogUploadTotal ?? 0) + files.length;
  notify();
  pump();
  return { persisted };
}

export function subscribeUploadQueue(listener: (state: QueueState) => void): () => void {
  const q = getQueue();
  q.listeners.add(listener);
  bindWakeListeners();
  void restoreQueue().catch(() => {});
  // Push initial state so the subscriber renders immediately.
  notify();
  return () => { q.listeners.delete(listener); };
}
