import type { SupabaseClient } from "@supabase/supabase-js";

/** Longest edge (px) for feed/grid thumbnails. */
export const THUMB_BOX = 800;

/**
 * Mint signed URLs that serve a resized thumbnail instead of the multi-MB
 * original.
 *
 * WHY THIS ISN'T A STRING REWRITE: the previous approach took an already-signed
 * `/object/sign/` URL, swapped the path to `/render/image/sign/` and appended
 * `?width=…`. That silently does nothing — the transform has to be part of what
 * the token authorizes, so query params bolted on afterwards are ignored.
 * Measured against a real 4032x3024 / 6,052 kB field photo:
 *
 *   signed URL + "&width=800&quality=75"        -> 3000x4000, 3,078 kB  (ignored)
 *   signed URL + width+height+resize appended   -> 3000x4000, 3,078 kB  (ignored)
 *   createSignedUrl(..., { transform })         ->  600x800,    126 kB  ✅
 *
 * `resize: "contain"` fits the photo inside the box preserving aspect ratio and
 * never crops, so one thumbnail is safe for every call site regardless of the
 * container's aspect — the CSS `object-cover` does the visual cropping.
 *
 * The batch `createSignedUrls()` does NOT accept a `transform` option (only
 * `download`), so thumbnails must be signed one path at a time. They're fired
 * in parallel, so this costs one round-trip of latency, not N.
 *
 * Returns a path -> thumbnail-URL map. Paths that fail to sign are simply
 * absent; callers should fall back to the full-size signed URL.
 */
export async function signThumbUrls(
  supabase: SupabaseClient,
  bucket: string,
  paths: string[],
  expiresIn: number,
  box: number = THUMB_BOX,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return out;

  const signed = await Promise.all(
    unique.map(async (path) => {
      try {
        const { data } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn, {
          transform: { width: box, height: box, resize: "contain", quality: 75 },
        });
        return [path, data?.signedUrl ?? null] as const;
      } catch {
        return [path, null] as const;
      }
    }),
  );

  for (const [path, url] of signed) {
    if (url) out.set(path, url);
  }
  return out;
}
