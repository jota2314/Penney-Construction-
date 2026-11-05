"use client";

import { signDailyLogPhotos, type SignedPhoto } from "@/lib/actions/daily-logs";
import { signCompanyFeedPhotos } from "@/lib/actions/company-feed";

type Bucket = "logs" | "project";
type Photos = Record<string, SignedPhoto>;
type Request = { paths: string[]; resolve: (photos: Photos) => void; reject: (error: unknown) => void };
const queues: Record<Bucket, Request[]> = { logs: [], project: [] };
const scheduled = new Set<Bucket>();

async function flush(bucket: Bucket) {
  scheduled.delete(bucket);
  const requests = queues[bucket].splice(0);
  const paths = [...new Set(requests.flatMap((request) => request.paths))];
  const photos: Photos = {};
  try {
    for (let index = 0; index < paths.length; index += 24) {
      Object.assign(photos, await (bucket === "logs" ? signDailyLogPhotos : signCompanyFeedPhotos)(paths.slice(index, index + 24)));
    }
    for (const request of requests) request.resolve(Object.fromEntries(request.paths.filter((path) => photos[path]).map((path) => [path, photos[path]])));
  } catch (error) {
    for (const request of requests) request.reject(error);
  }
}

/** Cards entering together share one signing request per bucket/chunk. Do not
 * keep a global signed-URL cache across sign-in or impersonation changes. */
export function requestFeedPhotos(bucket: Bucket, paths: string[]): Promise<Photos> {
  if (!paths.length) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    queues[bucket].push({ paths, resolve, reject });
    if (scheduled.has(bucket)) return;
    scheduled.add(bucket);
    setTimeout(() => { void flush(bucket); }, 24);
  });
}
