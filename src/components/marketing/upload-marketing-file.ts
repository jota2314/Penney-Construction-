"use client";

import { Upload } from "tus-js-client";
import { finalizeMarketingUpload, reserveMarketingUpload } from "@/lib/actions/marketing";
import { mimeOf } from "./marketing-utils";
import type { MarketingAsset } from "@/types/marketing";

export type UploadReservation = NonNullable<Awaited<ReturnType<typeof reserveMarketingUpload>>["upload"]>;
export type QueuedFile = {
  id: string;
  file: File;
  role: "media" | "cover" | "download";
  preview?: string;
  progress: number;
  state: "queued" | "uploading" | "done" | "error";
  error?: string;
  reservation?: UploadReservation;
  asset?: MarketingAsset;
};

export async function uploadMarketingFile(
  itemId: string,
  entry: QueuedFile,
  sortOrder: number,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  onReserved: (reservation: UploadReservation) => void,
): Promise<MarketingAsset> {
  if (signal.aborted) throw new Error("Upload paused. Your saved files are safe; retry when you are ready.");
  let reservation = entry.reservation;
  // A transfer may have finished before its confirmation response was lost.
  // Verify it first so Retry does not attempt to overwrite the stored object.
  if (reservation) {
    const alreadyUploaded = await finalizeMarketingUpload(reservation.asset_id);
    if (alreadyUploaded.asset) return alreadyUploaded.asset;
    if (signal.aborted) throw new Error("Upload paused. Your saved files are safe; retry when you are ready.");
  }
  if (!reservation) {
    const response = await reserveMarketingUpload({ item_id: itemId, filename: entry.file.name, mime_type: mimeOf(entry.file), size: entry.file.size, role: entry.role, sort_order: sortOrder });
    if (!response.upload) throw new Error(response.error || "Could not start this upload.");
    reservation = response.upload;
    onReserved(reservation);
  }
  const target = reservation;
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", stop);
      if (error) reject(error); else resolve();
    };
    const upload = new Upload(entry.file, {
      endpoint: target.endpoint,
      chunkSize: target.chunk_size,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: { "x-signature": target.token, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      metadata: { bucketName: target.bucket, objectName: target.path, contentType: mimeOf(entry.file), cacheControl: "3600" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      fingerprint: async () => `penney-marketing-${target.asset_id}-${entry.file.size}-${entry.file.lastModified}`,
      onProgress: (uploaded, total) => onProgress(total ? Math.round(uploaded / total * 100) : 0),
      onError: (error) => finish(new Error(error.message || "Upload failed. Check your connection and retry.")),
      onSuccess: () => finish(),
    });
    const stop = () => {
      void upload.abort().catch(() => undefined);
      finish(new Error("Upload paused. Your saved files are safe; retry when you are ready."));
    };
    signal.addEventListener("abort", stop, { once: true });
    upload.findPreviousUploads().then((previous) => {
      if (finished || signal.aborted) { stop(); return; }
      if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch((error) => finish(error instanceof Error ? error : new Error("Could not start upload.")));
  });
  const completed = await finalizeMarketingUpload(target.asset_id);
  if (!completed.asset) throw new Error(completed.error || "File uploaded, but could not be verified. Retry to finish saving it.");
  return completed.asset;
}
