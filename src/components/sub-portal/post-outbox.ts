"use client";

/**
 * The sub portal's post outbox: a post (or a clock-out) is never lost to a
 * weak signal or a killed app.
 *
 * submitSubPost / submitSubClockOut:
 *   1. Shrink the photos on the phone (the same compress helper the crew
 *      queue uses), so ten photos are ~3 MB, not 40.
 *   2. Save the whole thing (text, chips, photo blobs with their upload IDs)
 *      to IndexedDB in ONE write, before anything is sent. Only then does the
 *      composer get its answer, so it can clear.
 *   3. Create the row. A post's id is made on the phone, so a retry can't post
 *      twice: the route answers created:false for a row that already exists.
 *   4. Hand the photos to the shared upload queue (sub scope →
 *      /api/sub-portal/logs/photo), then drop the outbox entry. The photos
 *      keep their upload IDs, so a handoff repeated after a crash stores and
 *      uploads each photo once.
 *
 * No signal: the entry stays on the phone and goes out on the next `online`,
 * on the app coming back to the front, on resumeSubOutbox() and on Retry.
 * The server saying no (not your job, staff browser) on the first try comes
 * back as { ok: false } and the composer keeps what he typed; the same answer
 * later marks the entry failed, still on the phone, until Retry. Nothing here
 * ever deletes an entry that hasn't reached the server.
 *
 * If the phone can't store anything at all (private mode, storage full), the
 * post goes straight from memory; if that also fails, the composer is told to
 * keep it on screen.
 *
 * Every entry belongs to the company signed in when it was saved (`subId`,
 * also sent in the body so the server can refuse a mismatch with 409). The
 * portal sets the owner from its GET (setSubOutboxOwner) and clears it on
 * sign-out; only the owner's entries are sent, retried or counted. Another
 * company's entries stay on the phone untouched until that company signs in
 * here again, so a shared phone never posts one company's photos as another's.
 * A post also carries `postedAt` (when he tapped), so one sent late is dated
 * on the day he took it.
 *
 * Window events for the screens: "sub-outbox-sent" { kind, logId, projectId }
 * when an entry reaches the server, and the queue's "sub-log-photo-saved"
 * { logId } as each photo lands.
 */

import { useEffect, useState } from "react";
import type { SubClockRequest, SubPostCreateRequest } from "@/lib/sub-portal/payload";
import {
  enqueueSavedPhotos,
  retryPhotoUploads,
  shrinkPhotos,
  subscribeUploadQueue,
  type QueueState,
} from "@/lib/upload/daily-log-upload-queue";

type ClockOutRequest = Extract<SubClockRequest, { action: "out" }>;

/** What a submit resolves to. `queued` = saved on the phone, not on the server yet. */
export type SubOutboxResult = { ok: true; logId: string; queued: boolean } | { ok: false; error: string };

export const SUB_OUTBOX_SENT_EVENT = "sub-outbox-sent";

const DATABASE = "penney-sub-outbox";
const STORE = "items";
const REQUEST_TIMEOUT_MS = 30_000;
const POST_ENDPOINT = "/api/sub-portal/logs";
const CLOCK_ENDPOINT = "/api/sub-portal/clock";

interface OutboxPhoto {
  /** The upload ID: the photo lands at {logId}/{id}.jpg. */
  id: string;
  file: Blob;
  shrunk: boolean;
}

interface OutboxItem {
  /** "post:{logId}" or "out:{random}" (two clock-outs of one shift are two entries). */
  key: string;
  kind: "post" | "clock_out";
  /**
   * The company signed in when it was saved. Only that company's login sends
   * it; an entry without one is held, never sent or deleted.
   */
  subId?: string;
  /** The post's own id, or the shift being closed. Photos attach here. */
  logId: string;
  projectId: string | null;
  body: SubPostCreateRequest | ClockOutRequest;
  photos: OutboxPhoto[];
  /** When he tapped. A clock-out sent late uses it as the real end time. */
  createdAt: string;
  attempts: number;
  /** The server's last "no", shown until Retry. */
  error?: string;
  /** The server refused; it waits for Retry instead of retrying itself. */
  stuck?: boolean;
  /** Sent with endedAt = createdAt because it went out late. */
  stampedEnd?: boolean;
  /** The phone's clock was off; send the clock-out without an end time. */
  noStamp?: boolean;
  /** Couldn't be stored on the phone; lives only in this app session. */
  memoryOnly?: boolean;
}

type Outcome =
  | { kind: "done"; logId: string }
  /** Try again later. `offline` = no answer at all, so the rest would fail too. */
  | { kind: "retry"; error: string; offline?: boolean }
  | { kind: "refused"; error: string };

const NO_SIGNAL: Outcome = { kind: "retry", error: "No signal. It sends when you have signal.", offline: true };

interface OutboxState {
  items: Map<string, OutboxItem>;
  sending: Map<string, Promise<Outcome>>;
  listeners: Set<() => void>;
  loaded?: Promise<void>;
  flushing?: Promise<void>;
  wired?: boolean;
  /** The signed-in company (setSubOutboxOwner). Unset: nothing is sent. */
  owner?: string;
}

declare global {
  var __pcSubOutbox: OutboxState | undefined;
}

function getOutbox(): OutboxState {
  globalThis.__pcSubOutbox ??= { items: new Map(), sending: new Map(), listeners: new Set() };
  return globalThis.__pcSubOutbox;
}

function changed() {
  getOutbox().listeners.forEach((fn) => fn());
}

// ─────────────────────────────── IndexedDB

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Post storage is busy. Close other Penney tabs and try again."));
  });
}

async function writeTx(run: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Could not save on this phone."));
      tx.onerror = () => reject(tx.error);
      run(tx.objectStore(STORE));
    });
  } finally {
    db.close();
  }
}

const storeItem = (item: OutboxItem) =>
  writeTx((store) => {
    // Bookkeeping that only matters in this session stays out of storage.
    const saved = { ...item };
    delete saved.memoryOnly;
    store.put(saved);
  });

const unstoreItem = (key: string) => writeTx((store) => store.delete(key));

async function loadStoredItems(): Promise<OutboxItem[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as OutboxItem[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Save a change to an entry; a phone that can't store it keeps it in memory. */
async function persist(item: OutboxItem) {
  if (item.memoryOnly) return;
  await storeItem(item).catch((error) => console.warn("[sub-outbox] could not update a saved post:", error));
}

/** Read the saved entries into memory once per app session. */
function loadOutbox(): Promise<void> {
  const box = getOutbox();
  if (!box.loaded) {
    box.loaded = loadStoredItems()
      .then((items) => {
        for (const item of items) if (!box.items.has(item.key)) box.items.set(item.key, item);
        changed();
      })
      .catch((error) => {
        box.loaded = undefined;
        console.warn("[sub-outbox] could not read saved posts:", error);
      });
  }
  return box.loaded;
}

// ─────────────────────────────── sending

async function postJson(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> | null } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, data };
  } catch {
    return null; // no signal, timed out, or the app went to the background
  } finally {
    clearTimeout(timeout);
  }
}

/** No answer, a server hiccup or an expired login: keep it and try later. Any other "no" is final. */
function classify(res: { status: number; data: Record<string, unknown> | null } | null, fallback: string): Outcome | null {
  if (!res) return NO_SIGNAL;
  const error = typeof res.data?.error === "string" ? res.data.error : null;
  if (res.status >= 200 && res.status < 300 && res.data?.ok === true && typeof res.data.logId === "string") return null;
  if (res.status === 401) return { kind: "retry", error: "Sign in again and it sends." };
  if (res.status >= 500 || res.status === 408 || res.status === 429 || res.status < 400) {
    return { kind: "retry", error: error || fallback };
  }
  return { kind: "refused", error: error || fallback };
}

function clockBody(item: OutboxItem): ClockOutRequest {
  const body = { ...(item.body as ClockOutRequest) };
  if (item.noStamp) delete body.endedAt;
  else if (item.stampedEnd && !body.endedAt) body.endedAt = item.createdAt;
  return body;
}

async function sendOnce(item: OutboxItem): Promise<Outcome> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return NO_SIGNAL;

  let logId = item.logId;
  if (item.kind === "post") {
    const res = await postJson(POST_ENDPOINT, item.body);
    const bad = classify(res, "Couldn't post. Try again.");
    if (bad) return bad;
    logId = String(res!.data!.logId);
  } else {
    // Sent late: the shift ends when he tapped, not when the signal came back.
    if (item.attempts > 0 && !item.stampedEnd && !item.noStamp && !(item.body as ClockOutRequest).endedAt) {
      item.stampedEnd = true;
      await persist(item);
    }
    let res = await postJson(CLOCK_ENDPOINT, clockBody(item));
    if (res?.status === 400 && item.stampedEnd) {
      // The phone's clock runs ahead of the server's: close it at "now" instead.
      item.stampedEnd = false;
      item.noStamp = true;
      await persist(item);
      res = await postJson(CLOCK_ENDPOINT, clockBody(item));
    }
    const bad = classify(res, "Couldn't clock out. Try again.");
    if (bad) return bad;
    logId = String(res!.data!.logId);
  }

  // The row exists. Photos go to the upload queue, then the entry goes.
  // A crash between the two re-sends the row (no duplicate) and re-hands the
  // same photo IDs (no duplicate) on the next resume.
  if (item.photos.length > 0) {
    try {
      await enqueueSavedPhotos(
        item.photos.map((photo) => ({ id: photo.id, logId, file: photo.file, shrunk: photo.shrunk })),
        "sub",
      );
    } catch {
      return { kind: "retry", error: "Photos are waiting to upload." };
    }
  }
  return { kind: "done", logId };
}

/** One try at one entry, and what it leaves behind. */
async function attempt(item: OutboxItem): Promise<Outcome> {
  const box = getOutbox();
  const outcome = await sendOnce(item);
  item.attempts += 1;
  if (outcome.kind === "done") {
    box.items.delete(item.key);
    if (!item.memoryOnly) await unstoreItem(item.key).catch(() => {});
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(SUB_OUTBOX_SENT_EVENT, {
          detail: { kind: item.kind, logId: outcome.logId, projectId: item.projectId },
        }),
      );
    }
  } else {
    item.error = outcome.error;
    if (outcome.kind === "refused") item.stuck = true;
    await persist(item);
  }
  return outcome;
}

/** Send one entry; a second caller for the same entry waits on the first. */
function sendItem(item: OutboxItem): Promise<Outcome> {
  const box = getOutbox();
  const running = box.sending.get(item.key);
  if (running) return running;
  const run = attempt(item).finally(() => {
    box.sending.delete(item.key);
    changed();
  });
  box.sending.set(item.key, run);
  changed();
  return run;
}

/** This entry belongs to whoever is signed in now. */
const isOwners = (item: OutboxItem) => !!item.subId && item.subId === getOutbox().owner;

/**
 * Send everything waiting, oldest first, one at a time (weak signal). Only the
 * signed-in company's entries; another company's stay on the phone for them.
 */
function flush(): Promise<void> {
  const box = getOutbox();
  if (!box.owner) return Promise.resolve();
  if (!box.flushing) {
    box.flushing = (async () => {
      await loadOutbox();
      const waiting = [...box.items.values()]
        .filter((item) => !item.stuck && isOwners(item))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const item of waiting) {
        if (!box.items.has(item.key)) continue;
        // Signed out (or someone else signed in) partway through: stop.
        if (!isOwners(item)) continue;
        const outcome = await sendItem(item);
        // Still no signal: the rest would fail the same way.
        if (outcome.kind === "retry" && outcome.offline) break;
      }
    })().finally(() => {
      box.flushing = undefined;
    });
  }
  return box.flushing;
}

/** Save the entry on the phone, then try it once now. */
async function submit(item: OutboxItem): Promise<SubOutboxResult> {
  const box = getOutbox();
  try {
    await storeItem(item);
  } catch (error) {
    console.warn("[sub-outbox] could not save on this phone:", error);
    item.memoryOnly = true;
  }
  box.items.set(item.key, item);
  changed();

  const outcome = await sendItem(item);
  if (outcome.kind === "done") return { ok: true, logId: outcome.logId, queued: false };

  if (outcome.kind === "refused" || item.memoryOnly) {
    // He still has it on screen, so this copy goes: keeping both would post
    // it twice when he taps again.
    box.items.delete(item.key);
    if (!item.memoryOnly) await unstoreItem(item.key).catch(() => {});
    changed();
    return {
      ok: false,
      error:
        outcome.kind === "refused"
          ? outcome.error
          : "No signal, and this phone couldn't save it. Keep this screen open and try again when you have signal.",
    };
  }
  return { ok: true, logId: item.logId, queued: true };
}

async function preparePhotos(
  photos: File[],
  onPrepared?: (done: number, total: number) => void,
): Promise<OutboxPhoto[]> {
  const shrunk = await shrinkPhotos(photos, onPrepared);
  return shrunk.map(({ file, shrunk }) => ({ id: crypto.randomUUID(), file, shrunk }));
}

// ─────────────────────────────── public API

/**
 * Post an update with photos. Resolves once it is safe on the phone (or on
 * the server): { ok: true, logId, queued } lets the composer clear;
 * { ok: false, error } means keep it on screen.
 */
export async function submitSubPost({
  request,
  photos,
  onPrepared,
}: {
  request: SubPostCreateRequest;
  photos: File[];
  /** Shrinking progress, for "Getting photos ready 3 of 10". */
  onPrepared?: (done: number, total: number) => void;
}): Promise<SubOutboxResult> {
  if (!request.id || !request.projectId) return { ok: false, error: "Pick a job first." };
  const subId = getOutbox().owner;
  if (!subId) return { ok: false, error: "Open the app again to post." };
  // When he tapped: sent on every try, so a late send is dated when he posted, not when it arrived.
  const createdAt = new Date().toISOString();
  const prepared = await preparePhotos(photos, onPrepared);
  return submit({
    key: `post:${request.id}`,
    kind: "post",
    subId,
    logId: request.id,
    projectId: request.projectId,
    body: { ...request, pendingPhotoCount: prepared.length, postedAt: createdAt, subId },
    photos: prepared,
    createdAt,
    attempts: 0,
  });
}

/** Clock out of the open shift with the composer's text, chips and photos. */
export async function submitSubClockOut({
  request,
  photos,
  onPrepared,
}: {
  request: ClockOutRequest;
  photos: File[];
  onPrepared?: (done: number, total: number) => void;
}): Promise<SubOutboxResult> {
  if (!request.logId) return { ok: false, error: "Open the app again; that shift isn't on this screen any more." };
  const subId = getOutbox().owner;
  if (!subId) return { ok: false, error: "Open the app again to clock out." };
  const createdAt = new Date().toISOString();
  const prepared = await preparePhotos(photos, onPrepared);
  return submit({
    key: `out:${crypto.randomUUID()}`,
    kind: "clock_out",
    subId,
    logId: request.logId,
    projectId: null,
    body: { ...request, action: "out", pendingPhotoCount: prepared.length, subId },
    photos: prepared,
    createdAt,
    attempts: 0,
  });
}

/**
 * Who is signed in on this phone: the portal calls it with the GET's
 * sub.sub_id (then sends that company's waiting entries), and with null on
 * sign-out, before the cookie goes, so nothing is sent under the next login.
 * Never call it from the staff preview.
 */
export function setSubOutboxOwner(subId: string | null): void {
  const box = getOutbox();
  box.owner = subId || undefined;
  changed();
  if (box.owner && typeof window !== "undefined") void flush();
}

/**
 * Send whatever is waiting on this phone: saved posts and clock-outs, and
 * unfinished photo uploads. Call it when the sub portal opens and when it
 * comes back to the front (it also listens for `online` and
 * `visibilitychange` itself). Posts and clock-outs only go once the portal
 * has set who is signed in (setSubOutboxOwner). Never call it from the staff
 * preview.
 */
export function resumeSubOutbox(): void {
  if (typeof window === "undefined") return;
  const box = getOutbox();
  if (!box.wired) {
    box.wired = true;
    const wake = () => {
      void flush();
      void retryPhotoUploads("sub");
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") wake();
    });
  }
  void flush();
  void retryPhotoUploads("sub");
}

export interface SubOutboxStatus {
  /** Posts and photos still to send (waiting or sending). */
  pending: number;
  /** Of those, sending right now. */
  sending: number;
  /** Refused by the server or out of retries; they wait for Retry. */
  failed: number;
  /** The posts and clock-outs the server refused, oldest first, with its reason. */
  refused: RefusedEntry[];
  /** For "Sending 3 of 14": photos landed so far… */
  done: number;
  /** …out of this batch (photos, and posts without photos). */
  total: number;
  /** Try every failed post and photo again now. */
  retryNow: () => void;
}

/** An entry the server said no to. It waits for Retry; it is never dropped. */
export interface RefusedEntry {
  key: string;
  kind: "post" | "clock_out";
  projectId: string | null;
  /** The server's reason, e.g. "That job isn't on your list". */
  error: string;
  /** His words, so the banner can say which entry it is. */
  text: string;
}

function retryNow() {
  // Load first: entries saved before a restart must lose their "failed" mark too.
  // Only his own: another company's refused post must not go out under this login.
  void loadOutbox().then(() => {
    for (const item of getOutbox().items.values()) {
      if (!isOwners(item)) continue;
      item.stuck = false;
      item.error = undefined;
    }
    changed();
    void flush();
  });
  void retryPhotoUploads("sub");
}

const EMPTY_QUEUE: QueueState = { pending: 0, inFlight: 0, total: 0, completed: 0, failed: 0, memoryOnly: 0 };

const REFUSED_FALLBACK = "Penney's system didn't accept this.";

function outboxCounts() {
  const box = getOutbox();
  let waiting = 0;
  let stuck = 0;
  let units = 0;
  const stuckItems: OutboxItem[] = [];
  for (const item of box.items.values()) {
    // Another company's entries are held for them; this login's banner doesn't count them.
    if (!isOwners(item)) continue;
    if (item.stuck) {
      stuck += 1;
      stuckItems.push(item);
    } else waiting += 1;
    units += Math.max(1, item.photos.length);
  }
  const refused: RefusedEntry[] = stuckItems
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((item) => {
      const text = (item.body as { text?: unknown }).text;
      return {
        key: item.key,
        kind: item.kind,
        projectId: item.projectId,
        error: item.error || REFUSED_FALLBACK,
        text: typeof text === "string" ? text : "",
      };
    });
  return { waiting, stuck, units, sending: box.sending.size, refused };
}

/** Live counts for the "Sending 3 of 14 · it finishes next time you open the app" banner. */
export function useSubOutbox(): SubOutboxStatus {
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE);
  const [box, setBox] = useState<ReturnType<typeof outboxCounts>>(() => ({
    waiting: 0,
    stuck: 0,
    units: 0,
    sending: 0,
    refused: [],
  }));

  useEffect(() => {
    const outbox = getOutbox();
    const onBox = () => setBox(outboxCounts());
    outbox.listeners.add(onBox);
    onBox();
    const unsubscribe = subscribeUploadQueue(setQueue, "sub");
    return () => {
      outbox.listeners.delete(onBox);
      unsubscribe();
    };
  }, []);

  return {
    pending: box.waiting + queue.pending + queue.inFlight,
    sending: box.sending + queue.inFlight,
    failed: box.stuck + queue.failed,
    refused: box.refused,
    done: queue.completed,
    total: queue.total + box.units,
    retryNow,
  };
}
