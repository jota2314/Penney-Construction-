import type { SupabaseClient } from "@supabase/supabase-js";
import { cachedSignedUrls, lookupSignedUrl, rememberSignedUrl } from "@/lib/storage/signed-url-cache";
import { signThumbUrls } from "@/lib/image/transform-signed-url";
import { THUMB_MAX_EDGE } from "./checkouts";

const BUCKET = "warehouse-photos";
const TTL_SECONDS = 60 * 60 * 24;

/**
 * Signed URLs for the inventory list thumbnails, keyed by item id.
 *
 * The browser uploads a small `_thumb.jpg` next to every photo, so the whole
 * 370-item list signs in ONE batched Storage call (cached across renders).
 * Signing a resize transform per item instead would be one Storage POST each
 * — the batch API can't carry a transform (see transform-signed-url.ts). A
 * transform is only used for an item that somehow has a photo but no thumb.
 */
export async function signWarehouseThumbs(
  supabase: SupabaseClient,
  items: { id: string; photo_path: string | null; photo_thumb_path: string | null }[],
): Promise<Record<string, string>> {
  const withThumb = items.filter((i) => i.photo_thumb_path);
  const photoOnly = items.filter((i) => i.photo_path && !i.photo_thumb_path);

  const [{ data: signed }, transformed] = await Promise.all([
    cachedSignedUrls(
      supabase,
      BUCKET,
      withThumb.map((i) => i.photo_thumb_path as string),
      TTL_SECONDS,
    ),
    signThumbUrls(
      supabase,
      BUCKET,
      photoOnly.map((i) => i.photo_path as string),
      TTL_SECONDS,
      THUMB_MAX_EDGE,
    ),
  ]);

  const byPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const out: Record<string, string> = {};
  for (const i of withThumb) {
    const url = byPath.get(i.photo_thumb_path as string);
    if (url) out[i.id] = url;
  }
  for (const i of photoOnly) {
    const url = transformed.get(i.photo_path as string);
    if (url) out[i.id] = url;
  }
  return out;
}

/** Full-size signed URL for the item page. Null when there is no photo. */
export async function signWarehousePhoto(
  supabase: SupabaseClient,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  const cached = lookupSignedUrl(BUCKET, "full", path);
  if (cached) return cached;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, TTL_SECONDS);
  if (!data?.signedUrl) return null;
  rememberSignedUrl(BUCKET, "full", path, data.signedUrl, TTL_SECONDS);
  return data.signedUrl;
}
