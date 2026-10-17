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
 * Two apps use it. The crew/office app (the default, and every existing
 * caller) uploads to /api/crew/daily-log-photo. The sub portal's post outbox
 * (src/components/sub-portal/post-outbox.ts) hands its photos over with the
 * "sub" scope, which uploads to /api/sub-portal/logs/photo. Each photo saves
 * its route with it, the two scopes run as separate queues with separate
 * counters, and each app restores only its own photos: a phone that has
 * both the crew app and the sub portal never sends one's photos through the
 * other's login.
 *
 * The active queue is a singleton across React renders and route changes.
 */

import { compressImage } from "@/lib/image/compress";
import { savePhotos, loadPhotos, removePhoto, type SavedPhoto } from "./persisted-photos";

const MAX_CONCURRENT = 3;
const MAX_CONCURRENT_SHRINK = 2;
const UPLOAD_TIMEOUT_MS = 45000;

/** Which app a queued photo belongs to. "crew" is the team app (and the default). */
export type UploadScope = "crew" | "sub";

/** The upload route for each scope. A saved photo with no endpoint is a crew photo. */
export const UPLOAD_ENDPOINTS: Record<UploadScope, string> = {
  crew: "/api/crew/daily-log-photo",
  sub: "/api/sub-portal/logs/photo",
};

/** The window event fired as each photo lands on its log (the crew name is unchanged). */
export const PHOTO_SAVED_EVENTS: Record<UploadScope, string> = {
  crew: "daily-log-photo-saved",
  sub: "sub-log-photo-saved",
};

/** The scope a saved photo restores under. Anything not sent to the sub route is crew. */
export function uploadScopeOf(photo: Pick<SavedPhoto, "endpoint">): UploadScope {
  return photo.endpoint === UPLOAD_ENDPOINTS.sub ? "sub" : "crew";
}

// Callers outside this file may hand in anything (an Event, if a function is
// passed straight to addEventListener). Only "sub" picks the sub queue.
const asScope = (scope: unknown): UploadScope => (scope === "sub" ? "sub" : "crew");

interface QueueItem extends SavedPhoto {
  attempts: number;
  /** The phone wouldn't store it; it only exists in this app session. */
  memoryOnly?: boolean;
}

interface Counters {
  completed: number;
  total: number;
  failed: number;
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
  /** Sub queue only. The crew counters stay on the globals below. */
  counts?: Counters;
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

type CounterKey = keyof Counters;

declare global {
  // The crew queue and its counters keep their original global names, so an
  // older bundle still running in this tab shares them with this one.
  var __pcDailyLogUploadQueue: Queue | undefined;
  var __pcDailyLogUploadCompleted: number | undefined;
  var __pcDailyLogUploadTotal: number | undefined;
  var __pcDailyLogUploadFailed: number | undefined;
  var __pcSubLogUploadQueue: Queue | undefined;
}

function emptyQueue(): Queue {
  return {
    pending: [],
    inFlight: 0,
    listeners: new Set(),
    knownIds: new Set(),
    failedItems: [],
    memoryOnlyIds: new Set(),
  };
}

function getQueue(scope: UploadScope = "crew"): Queue {
  if (scope === "sub") {
    globalThis.__pcSubLogUploadQueue ??= { ...emptyQueue(), counts: { completed: 0, total: 0, failed: 0 } };
    return globalThis.__pcSubLogUploadQueue;
  }
  if (!globalThis.__pcDailyLogUploadQueue) {
    globalThis.__pcDailyLogUploadQueue = emptyQueue();
    globalThis.__pcDailyLogUploadCompleted = 0;
    globalThis.__pcDailyLogUploadTotal = 0;
    globalThis.__pcDailyLogUploadFailed = 0;
  }
  // A queue created by an older bundle in this tab predates this field.
  globalThis.__pcDailyLogUploadQueue.memoryOnlyIds ??= new Set();
  return globalThis.__pcDailyLogUploadQueue;
}

function getCount(scope: UploadScope, key: CounterKey): number {
  if (scope === "sub") return getQueue("sub").counts?.[key] ?? 0;
  if (key === "completed") return globalThis.__pcDailyLogUploadCompleted ?? 0;
  if (key === "total") return globalThis.__pcDailyLogUploadTotal ?? 0;
  return globalThis.__pcDailyLogUploadFailed ?? 0;
}

function setCount(scope: UploadScope, key: CounterKey, value: number) {
  if (scope === "sub") {
    const q = getQueue("sub");
    q.counts ??= { completed: 0, total: 0, failed: 0 };
    q.counts[key] = value;
  } else if (key === "completed") globalThis.__pcDailyLogUploadCompleted = value;
  else if (key === "total") globalThis.__pcDailyLogUploadTotal = value;
  else globalThis.__pcDailyLogUploadFailed = value;
}

const addCount = (scope: UploadScope, key: CounterKey, n: number) => setCount(scope, key, getCount(scope, key) + n);

function notify(scope: UploadScope = "crew") {
  const q = getQueue(scope);
  const state: QueueState = {
    pending: q.pending.length,
    inFlight: q.inFlight,
    total: getCount(scope, "total"),
    completed: getCount(scope, "completed"),
    failed: getCount(scope, "failed"),
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

async function shrinkAll<T extends { file: Blob }>(
  items: T[],
  onPrepared?: (done: number, total: number) => void,
): Promise<(T & { shrunk: boolean })[]> {
  const out: (T & { shrunk: boolean })[] = new Array(items.length);
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
 * Shrink picked photos to upload size, two at a time, keeping their order.
 * The sub post outbox shrinks before it stores, so a phone short on room
 * holds ten small copies instead of ten camera originals.
 */
export async function shrinkPhotos(
  files: Blob[],
  onPrepared?: (done: number, total: number) => void,
): Promise<{ file: Blob; shrunk: boolean }[]> {
  return shrinkAll(files.map((file) => ({ file })), onPrepared);
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
  scope: UploadScope = "crew",
): Promise<void> {
  // The report route needs a team login; a sub phone only gets the console line.
  if (scope === "sub") {
    console.warn("[upload-queue] sub photo storage failed:", stage, fallback, error);
    return;
  }
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
async function processOne(item: QueueItem, scope: UploadScope): Promise<void> {
  // Photos queued before shrinking moved ahead of storage still need it.
  const body = item.shrunk ? item.file : (await shrink(item.file)).file;

  const fd = new FormData();
  fd.append("logId", item.logId);
  fd.append("uploadId", item.id);
  fd.append("file", body, "photo.jpg");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(item.endpoint || UPLOAD_ENDPOINTS[scope], {
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

function pump(scope: UploadScope = "crew") {
  const q = getQueue(scope);
  while (q.inFlight < MAX_CONCURRENT && q.pending.length > 0) {
    const item = q.pending.shift()!;
    q.inFlight++;
    notify(scope);
    processOne(item, scope)
      .then(async () => {
        // The photo is on the log. A stale device copy is harmless (re-upload
        // is idempotent by upload ID); re-queueing it here would not be.
        if (!item.memoryOnly) await removePhoto(item.id).catch(() => {});
        q.memoryOnlyIds.delete(item.id);
        q.knownIds.delete(item.id);
        addCount(scope, "completed", 1);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            scope === "sub"
              ? new CustomEvent(PHOTO_SAVED_EVENTS.sub, { detail: { logId: item.logId } })
              : new Event(PHOTO_SAVED_EVENTS.crew),
          );
        }
      })
      .catch((err) => {
        console.error("[upload-queue] photo failed:", err);
        // Retry up to 2 times for transient network errors.
        if (item.attempts < 2) {
          q.pending.push({ ...item, attempts: item.attempts + 1 });
        } else {
          // Surrender — surface it as failed instead of pretending it made it.
          addCount(scope, "failed", 1);
          q.failedItems.push(item);
        }
      })
      .finally(() => {
        q.inFlight--;
        notify(scope);
        pump(scope);
      });
  }
  if (q.pending.length === 0 && q.inFlight === 0) {
    // Reset counters when fully drained so the next post starts clean.
    // Leave failures on screen longer so the user actually sees them.
    const failed = getCount(scope, "failed");
    if (failed > 0) return; // Retain recoverable failures until retry succeeds.
    setTimeout(() => {
      if (q.pending.length === 0 && q.inFlight === 0) {
        setCount(scope, "completed", 0);
        setCount(scope, "total", 0);
        setCount(scope, "failed", 0);
        notify(scope);
      }
    }, failed > 0 ? 8000 : 1500);
  }
}

/** Load this scope's unfinished photos from the phone, once per app session. */
async function restoreQueue(scope: UploadScope = "crew"): Promise<void> {
  const q = getQueue(scope);
  if (!q.restore) {
    q.restore = loadPhotos().then(photos => {
      q.recoveryError = undefined;
      for (const photo of photos) {
        // The other app's photos stay on the phone for that app to send.
        if (uploadScopeOf(photo) !== scope) continue;
        if (q.knownIds.has(photo.id)) continue;
        q.knownIds.add(photo.id);
        q.pending.push({ ...photo, attempts: 0 });
        addCount(scope, "total", 1);
      }
      notify(scope);
      pump(scope);
    }).catch(error => {
      q.restore = undefined;
      q.recoveryError = "Could not recover pending photos on this device. Retry with the app open.";
      void reportStorageFailure("restore", error, undefined, [], undefined, scope);
      notify(scope);
      throw error;
    });
  }
  await q.restore;
}

/** Put failed photos back in line and pick up any saved on the phone. Crew by default. */
export async function retryPhotoUploads(scope: UploadScope = "crew"): Promise<void> {
  const s = asScope(scope);
  const q = getQueue(s);
  q.pending.push(...q.failedItems.splice(0).map(item => ({ ...item, attempts: 0 })));
  setCount(s, "failed", 0);
  await restoreQueue(s).catch(() => {});
  notify(s);
  pump(s);
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

/**
 * Queue photos that already have their upload IDs (and are usually already
 * shrunk), for the given scope. The sub post outbox calls this once the post
 * row exists. Saving uses the same IDs, so handing the same photos over
 * twice (after the app was killed mid-handoff) stores and uploads them once.
 * If the phone won't store them they upload from memory, as above.
 */
export async function enqueueSavedPhotos(
  photos: { id: string; logId: string; file: Blob; shrunk?: boolean }[],
  scope: UploadScope,
): Promise<void> {
  const s = asScope(scope);
  await restoreQueue(s).catch(() => {});
  const q = getQueue(s);
  const endpoint = UPLOAD_ENDPOINTS[s];
  const items: QueueItem[] = photos
    .filter((photo) => !q.knownIds.has(photo.id))
    .map(({ id, logId, file, shrunk }) => ({ id, logId, file, shrunk, endpoint, attempts: 0 }));
  if (items.length > 0) {
    try {
      await savePhotos(items.map(({ id, logId, file, shrunk, endpoint }) => ({ id, logId, file, shrunk, endpoint })));
    } catch (error) {
      for (const item of items) {
        item.memoryOnly = true;
        q.memoryOnlyIds.add(item.id);
      }
      void reportStorageFailure("save", error, items[0].logId, items, "memory", s);
    }
    for (const item of items) q.knownIds.add(item.id);
    q.pending.push(...items);
    addCount(s, "total", items.length);
  }
  notify(s);
  pump(s);
}

/**
 * Watch one queue. The crew queue (the default) also restores its saved
 * photos when the first screen subscribes, as it always has. The sub queue
 * only restores when the sub portal asks (resumeSubOutbox), so a staff
 * preview of the portal never starts uploads.
 */
export function subscribeUploadQueue(
  listener: (state: QueueState) => void,
  scope: UploadScope = "crew",
): () => void {
  const s = asScope(scope);
  const q = getQueue(s);
  q.listeners.add(listener);
  if (s === "crew") void restoreQueue().catch(() => {});
  // Push initial state so the subscriber renders immediately.
  notify(s);
  return () => { q.listeners.delete(listener); };
}
