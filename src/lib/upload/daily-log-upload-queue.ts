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
 * If the phone refuses the full-size files (storage full, or Android Chrome
 * unable to copy a gallery file), they are shrunk and stored again; if that
 * fails too they upload from memory instead of being dropped. Either way the
 * failure is reported so we can see why. Memory-only photos are lost if the
 * app is closed before they finish, so the banner says so.
 *
 * The active queue is a singleton across React renders and route changes.
 */

import { compressImage } from "@/lib/image/compress";
import { savePhotos, loadPhotos, removePhoto, type SavedPhoto } from "./persisted-photos";

const MAX_CONCURRENT = 3;
const MAX_CONCURRENT_SHRINK = 2;
const UPLOAD_TIMEOUT_MS = 45000;

interface QueueItem extends SavedPhoto {
  attempts: number;
  /** The phone wouldn't store it; it only exists in this app session. */
  memoryOnly?: boolean;
}

interface Queue {
  pending: QueueItem[];
  inFlight: number;
  listeners: Set<(state: QueueState) => void>;
  knownIds: Set<string>;
  failedItems: QueueItem[];
  memoryOnlyIds: Set<string>;
  restore?: Promise<void>;
  recoveryError?: string;
}

export interface QueueState {
  pending: number;
  inFlight: number;
  total: number;
  completed: number;
  failed: number;
  /** Unfinished photos that only live in memory — closing the app loses them. */
  memoryOnly: number;
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
      memoryOnlyIds: new Set(),
    };
    globalThis.__pcDailyLogUploadCompleted = 0;
    globalThis.__pcDailyLogUploadTotal = 0;
    globalThis.__pcDailyLogUploadFailed = 0;
  }
  // A queue created by an older bundle in this tab predates this field.
  globalThis.__pcDailyLogUploadQueue.memoryOnlyIds ??= new Set();
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
    memoryOnly: q.memoryOnlyIds.size,
    recoveryError: q.recoveryError,
  };
  q.listeners.forEach((fn) => fn(state));
}

/** Shrink to upload size. Undecodable images (e.g. some HEIC) stay original. */
async function shrink(file: Blob): Promise<{ file: Blob; shrunk: boolean }> {
  try {
    return { file: await compressImage(file), shrunk: true };
  } catch {
    return { file, shrunk: false };
  }
}

async function shrinkAll(
  items: QueueItem[],
  onPrepared?: (done: number, total: number) => void,
): Promise<QueueItem[]> {
  const out: QueueItem[] = new Array(items.length);
  let next = 0;
  let done = 0;
  onPrepared?.(0, items.length);
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = { ...items[index], ...(await shrink(items[index].file)) };
      onPrepared?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_SHRINK, items.length) }, worker));
  return out;
}

/**
 * Tell the server why this phone couldn't store photos. The catch used to
 * swallow the reason, which left a full phone and a browser bug looking
 * identical. Best effort: never blocks or fails the upload.
 */
async function reportStorageFailure(
  stage: "save" | "restore",
  error: unknown,
  logId?: string,
  items: QueueItem[] = [],
  fallback?: "shrunk" | "memory",
): Promise<void> {
  try {
    const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
    const err = error as { name?: unknown; message?: unknown } | null;
    await fetch("/api/crew/daily-log-photo/storage-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        stage,
        logId,
        fallback,
        errorName: typeof err?.name === "string" ? err.name : String(error),
        errorMessage: typeof err?.message === "string" ? err.message : undefined,
        photos: items.length,
        shrunk: items.filter((item) => item.shrunk).length,
        bytes: items.reduce((sum, item) => sum + item.file.size, 0),
        usage: estimate?.usage,
        quota: estimate?.quota,
        userAgent: navigator.userAgent,
      }),
    });
  } catch {
    // Reporting is diagnostics only.
  }
}

/**
 * Shrink + upload one photo through the same-origin API. The server
 * stores the file and appends its path to the log atomically.
 */
async function processOne(item: QueueItem): Promise<void> {
  // Photos queued before shrinking moved ahead of storage still need it.
  const body = item.shrunk ? item.file : (await shrink(item.file)).file;

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
      .then(async () => {
        // The photo is on the log. A stale device copy is harmless (re-upload
        // is idempotent by upload ID); re-queueing it here would not be.
        if (!item.memoryOnly) await removePhoto(item.id).catch(() => {});
        q.memoryOnlyIds.delete(item.id);
        q.knownIds.delete(item.id);
        globalThis.__pcDailyLogUploadCompleted = (globalThis.__pcDailyLogUploadCompleted ?? 0) + 1;
        if (typeof window !== "undefined") window.dispatchEvent(new Event("daily-log-photo-saved"));
      })
      .catch((err) => {
        console.error("[upload-queue] photo failed:", err);
        // Retry up to 2 times for transient network errors.
        if (item.attempts < 2) {
          q.pending.push({ ...item, attempts: item.attempts + 1 });
        } else {
          // Surrender — surface it as failed instead of pretending it made it.
          globalThis.__pcDailyLogUploadFailed = (globalThis.__pcDailyLogUploadFailed ?? 0) + 1;
          q.failedItems.push(item);
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
        q.pending.push({ ...photo, attempts: 0 });
        globalThis.__pcDailyLogUploadTotal = (globalThis.__pcDailyLogUploadTotal ?? 0) + 1;
      }
      notify();
      pump();
    }).catch(error => {
      q.restore = undefined;
      q.recoveryError = "Could not recover pending photos on this device. Retry with the app open.";
      void reportStorageFailure("restore", error);
      notify();
      throw error;
    });
  }
  await q.restore;
}

export async function retryPhotoUploads(): Promise<void> {
  const q = getQueue();
  q.pending.push(...q.failedItems.splice(0).map(item => ({ ...item, attempts: 0 })));
  globalThis.__pcDailyLogUploadFailed = 0;
  await restoreQueue().catch(() => {});
  notify();
  pump();
}

export async function enqueueDailyLogPhotos(
  logId: string,
  files: File[],
  onPrepared?: (done: number, total: number) => void,
): Promise<void> {
  // Older stuck photos failing to load must not block today's.
  await restoreQueue().catch(() => {});
  const q = getQueue();

  // Commit to device storage before dismissing the composer, so closing the
  // app can't lose them. Originals first: shrinking costs ~1s a photo, so
  // phones with room skip it here and shrink during upload.
  let items: QueueItem[] = files.map(file => ({ id: crypto.randomUUID(), logId, file, attempts: 0 }));
  try {
    await savePhotos(items);
  } catch (error) {
    // Short on room, or Android Chrome can't copy the gallery files. Shrunk
    // copies are ~10x smaller and fresh in memory, so try once more with
    // those, and upload from memory if the phone still says no.
    items = await shrinkAll(items, onPrepared);
    let fallback: "shrunk" | "memory" = "shrunk";
    try {
      await savePhotos(items.map(({ id, logId, file, shrunk }) => ({ id, logId, file, shrunk })));
    } catch {
      fallback = "memory";
      for (const item of items) {
        item.memoryOnly = true;
        q.memoryOnlyIds.add(item.id);
      }
    }
    void reportStorageFailure("save", error, logId, items, fallback);
  }
  for (const item of items) q.knownIds.add(item.id);
  q.pending.push(...items);
  globalThis.__pcDailyLogUploadTotal = (globalThis.__pcDailyLogUploadTotal ?? 0) + files.length;
  notify();
  pump();
}

export function subscribeUploadQueue(listener: (state: QueueState) => void): () => void {
  const q = getQueue();
  q.listeners.add(listener);
  void restoreQueue().catch(() => {});
  // Push initial state so the subscriber renders immediately.
  notify();
  return () => { q.listeners.delete(listener); };
}
