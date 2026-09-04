/**
 * One way to get a bill or receipt into /api/bills/scan from the browser.
 *
 * Why this exists: Vercel drops any request body over ~4.5 MB at the platform
 * edge — the route never runs, nothing is logged, and the client just sees a
 * non-JSON 413. A full-size iPhone photo is 4–6 MB, so the "Missing receipt"
 * upload in the spend organizer (which sent the raw file) failed every time
 * Nicole tried it, and BillDrop / AddBillDialog only survived because they
 * happened to downscale first. Now every caller goes through here:
 *
 *   1. photos are downscaled + re-encoded as JPEG (~200 KB)
 *   2. anything still over the cap (a big scanned PDF, an undecodable photo)
 *      goes straight from the browser into Supabase storage and the scan
 *      route is handed the storage path instead of the bytes
 *   3. the response is parsed defensively so a platform error page becomes a
 *      readable message instead of "check the connection"
 */

import { createClient } from "@/lib/supabase/client";
import { compressImage } from "./compress";

const BUCKET = "field-captures";
const PDF_MIME = "application/pdf";
/** Stay well under Vercel's 4.5 MB body limit — multipart adds overhead. */
const MULTIPART_MAX_BYTES = 4 * 1024 * 1024;
/** field-captures bucket limit (10 MB) — anything bigger can't be stored at all. */
const STORAGE_MAX_BYTES = 10 * 1024 * 1024;

export class BillUploadError extends Error {}

/** Downscale a photo to JPEG; PDFs and undecodable files pass through as-is. */
export async function prepareBillFile(file: File): Promise<File> {
  if (file.type === PDF_MIME) return file;
  try {
    const blob = await compressImage(file);
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
      type: blob.type || "image/jpeg",
    });
  } catch {
    // Undecodable (HEIC on a desktop browser, a corrupt file) — send the
    // original and let the route explain.
    return file;
  }
}

/**
 * Build the FormData for /api/bills/scan. Small files ride along as
 * multipart; large ones are uploaded to storage first and referenced by path.
 */
export async function buildScanForm(
  file: File,
  extra: Record<string, string> = {},
): Promise<FormData> {
  const upload = await prepareBillFile(file);
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) if (v) form.append(k, v);

  if (upload.size <= MULTIPART_MAX_BYTES) {
    form.append("file", upload);
    return form;
  }

  const { storagePath, filename } = await uploadBillToStorage(upload);
  form.append("storagePath", storagePath);
  form.append("filename", filename);
  return form;
}

/**
 * Put a (prepared) bill file straight into the field-captures bucket and
 * return its path. Used for files over the request cap, and as the manual
 * fallback: when the AI can't read a bill the file still gets attached to
 * whatever the person types in by hand.
 */
export async function uploadBillToStorage(
  upload: File,
): Promise<{ storagePath: string; filename: string }> {
  if (upload.size > STORAGE_MAX_BYTES) {
    throw new BillUploadError(
      `That file is ${(upload.size / 1024 / 1024).toFixed(1)} MB — the limit is 10 MB. Re-save the PDF smaller or split it.`,
    );
  }

  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new BillUploadError("Not signed in — reload and try again.");

  const ext = upload.type === PDF_MIME ? "pdf" : "jpg";
  const storagePath = `${auth.user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, upload, { contentType: upload.type || "image/jpeg" });
  if (error) throw new BillUploadError(`Upload failed: ${error.message}`);
  return { storagePath, filename: upload.name };
}

/**
 * Parse the scan/commit response. A 413 from the platform is an HTML page,
 * not JSON — say what happened instead of blaming the connection.
 */
export async function readJsonResponse<T = Record<string, unknown>>(
  res: Response,
): Promise<{ ok: boolean; json: (T & { error?: string }) | null; error: string | null }> {
  let json: (T & { error?: string }) | null = null;
  try {
    json = (await res.json()) as T & { error?: string };
  } catch {
    json = null;
  }
  if (res.ok && json) return { ok: true, json, error: null };
  if (json?.error) return { ok: false, json, error: json.error };
  if (res.status === 413) {
    return {
      ok: false,
      json,
      error: "That file is too big to send — try again, it will be shrunk first.",
    };
  }
  if (res.status === 401) return { ok: false, json, error: "Signed out — reload and try again." };
  if (res.status === 504) return { ok: false, json, error: "Reading that file timed out — try again." };
  return { ok: false, json, error: `Upload failed (HTTP ${res.status}).` };
}
