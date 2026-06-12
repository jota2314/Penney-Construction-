/**
 * Downscale + JPEG-compress an image in the browser before upload. Field photos
 * straight off a phone are multi-MB (and on iPhone often HEIC), which is what
 * stalls the direct-to-storage upload on weak job-site signal. Shrinking to a
 * sane max dimension and re-encoding as JPEG makes the upload small, fast, and
 * a consistent format.
 *
 * Returns a JPEG Blob. Throws if the image can't be decoded (e.g. a HEIC the
 * browser can't render) — callers should fall back to the original file.
 */
export async function compressImage(
  file: File,
  maxDim = 1600,
  quality = 0.82,
): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not decode image"));
      i.src = url;
    });

    const longest = Math.max(img.width, img.height) || maxDim;
    const scale = Math.min(1, maxDim / longest);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) throw new Error("Could not encode image");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
