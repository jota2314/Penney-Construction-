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
 *   4. The queue uploads them in parallel and appends each storage_path
 *      to the daily_log row as it completes.
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

import { createClient } from "@/lib/supabase/client";
import { appendDailyLogPhoto } from "@/lib/actions/daily-logs";

const PHOTO_BUCKET = "daily-log-photos";
const MAX_CONCURRENT = 4;

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
}

declare global {
  // eslint-disable-next-line no-var
  var __pcDailyLogUploadQueue: Queue | undefined;
  // eslint-disable-next-line no-var
  var __pcDailyLogUploadCompleted: number | undefined;
  // eslint-disable-next-line no-var
  var __pcDailyLogUploadTotal: number | undefined;
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
  };
  q.listeners.forEach((fn) => fn(state));
}

async function processOne(item: QueueItem): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const ext = item.file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, item.file, { contentType: item.file.type, upsert: false });
  if (upErr) throw new Error(upErr.message);

  const result = await appendDailyLogPhoto(item.logId, path);
  if (result.error) throw new Error(result.error);
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
          // Surrender — count as completed so the counter still reaches total.
          globalThis.__pcDailyLogUploadCompleted = (globalThis.__pcDailyLogUploadCompleted ?? 0) + 1;
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
    setTimeout(() => {
      if (q.pending.length === 0 && q.inFlight === 0) {
        globalThis.__pcDailyLogUploadCompleted = 0;
        globalThis.__pcDailyLogUploadTotal = 0;
        notify();
      }
    }, 1500);
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
