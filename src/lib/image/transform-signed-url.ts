/**
 * Rewrite a Supabase storage signed URL to the image-render endpoint so the
 * CDN serves a resized/recompressed variant instead of the multi-MB original.
 * `createSignedUrls()` (the batch call) can't mint transform URLs directly,
 * but the same signed token is valid on `/render/image/sign/`, so we swap the
 * path segment and append the resize params. Requires a plan with image
 * transformations enabled (we're on Pro).
 *
 * Non-signed or unrecognized URLs are returned unchanged.
 */
export function transformSignedUrl(url: string, width: number, quality = 75): string {
  if (!url.includes("/object/sign/")) return url;
  const rendered = url.replace("/object/sign/", "/render/image/sign/");
  const separator = rendered.includes("?") ? "&" : "?";
  return `${rendered}${separator}width=${width}&quality=${quality}`;
}
