import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findProjectBySiteCode, isSiteOpen } from "@/lib/sub-portal/site-code";

export const GUEST_PHOTO_LIMIT = 6;
export const GUEST_PHOTO_BYTES = 600 * 1024;
export const GUEST_BODY_BYTES = 4 * 1024 * 1024;
const BUCKET = "daily-log-photos";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SITE_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

export class GuestUploadError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export type GuestPhotoInput = {
  code: string;
  submissionId: string;
  name: string;
  note: string;
  photos: Blob[];
};

/** No public project ID, existing-log ID, storage path or author is accepted. */
export function parseGuestPhotoForm(form: FormData): GuestPhotoInput {
  const string = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)).trim() : "";
  if (string("website")) throw new GuestUploadError("Couldn't post these photos.");
  const code = string("code").toUpperCase();
  const submissionId = string("submissionId");
  const name = string("name");
  const note = string("note");
  const entries = form.getAll("photos");
  if (!SITE_CODE.test(code)) throw new GuestUploadError("This job code isn't active.", 404);
  if (!UUID.test(submissionId)) throw new GuestUploadError("Please select the photos again.");
  if (name.length > 100 || note.length > 2000) throw new GuestUploadError("Please shorten the name or note.");
  if (entries.length < 1 || entries.length > GUEST_PHOTO_LIMIT) throw new GuestUploadError("Choose 1 to 6 photos.");
  const photos: Blob[] = [];
  for (const file of entries) {
    if (!(file instanceof Blob) || !file.size || file.size > GUEST_PHOTO_BYTES) {
      throw new GuestUploadError("One photo is too large or empty. Please select it again.", 413);
    }
    if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type)) {
      throw new GuestUploadError("Please choose photos, not documents or videos.");
    }
    photos.push(file);
  }
  return { code, submissionId, name, note, photos };
}

/** Decode real pixels, discard metadata, and store only a normalized JPEG. */
export async function normalizeGuestPhoto(photo: Blob): Promise<Buffer> {
  try {
    const input = Buffer.from(await photo.arrayBuffer());
    const image = sharp(input, { limitInputPixels: 40_000_000, failOn: "error", animated: false });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp", "heif"].includes(metadata.format) || (metadata.pages ?? 1) > 1) {
      throw new Error("Unsupported image");
    }
    return await image.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 }).toBuffer();
  } catch {
    throw new GuestUploadError("One of these photos couldn't be read. Please choose it again.");
  }
}

type SavedPost = { id: string; project_id: string | null; is_site_guest: boolean };

async function findSaved(admin: SupabaseClient, id: string): Promise<SavedPost | null> {
  const { data, error } = await admin.from("daily_logs").select("id, project_id, is_site_guest").eq("id", id).maybeSingle();
  if (error) throw new GuestUploadError("Couldn't check this post. Please try again.", 503);
  return data as SavedPost | null;
}

function isThisPost(saved: SavedPost, projectId: string) {
  if (!saved.is_site_guest || saved.project_id !== projectId) {
    throw new GuestUploadError("Please start a new photo post.", 409);
  }
  return { ok: true as const, logId: saved.id, duplicate: true, projectId };
}

/** The QR grants only a photo submission to this job, never access to its records. */
export async function saveGuestPhotos(
  admin: SupabaseClient,
  input: GuestPhotoInput,
  normalize: (photo: Blob) => Promise<Buffer> = normalizeGuestPhoto,
) {
  const project = await findProjectBySiteCode(admin, input.code);
  if (!project) throw new GuestUploadError("This job code isn't active. Please scan the sign again.", 404);
  // A lost success response can be acknowledged even if the job was closed later.
  const saved = await findSaved(admin, input.submissionId);
  if (saved) return isThisPost(saved, project.id);
  if (!isSiteOpen(project)) throw new GuestUploadError("This job isn't accepting photos right now. Please contact the Penney office.", 409);

  // Reject before transferring images. A database trigger also enforces this
  // under a project lock, so concurrent requests cannot bypass the hourly cap.
  const { count, error: countError } = await admin.from("daily_logs")
    .select("id", { count: "exact", head: true }).eq("project_id", project.id).eq("is_site_guest", true)
    .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
  if (countError) throw new GuestUploadError("Couldn't open photo posting. Please try again.", 503);
  if ((count ?? 0) >= 60) throw new GuestUploadError("This job has received a lot of photos. Please try again later.", 429);

  // Validate every image before uploading anything. Unique attempt paths mean
  // a retry can never overwrite photos, including a simultaneous successful try.
  const images: Buffer[] = [];
  for (const photo of input.photos) images.push(await normalize(photo));
  const attempt = randomUUID();
  const paths: string[] = [];
  const cleanup = async () => {
    if (!paths.length) return;
    const { error } = await admin.storage.from(BUCKET).remove(paths);
    if (error) console.error("[site-photos] Upload cleanup failed", error.message);
  };
  let insertAttempted = false;
  try {
    for (let index = 0; index < images.length; index++) {
      const path = `${input.submissionId}/${attempt}-${index}.jpg`;
      // Include the in-flight path in cleanup too: a storage response can be lost.
      paths.push(path);
      const { error } = await admin.storage.from(BUCKET).upload(path, images[index], { contentType: "image/jpeg", upsert: false });
      if (error) throw new GuestUploadError("Couldn't upload all photos. Keep this page open and try again.", 503);
    }

    const at = new Date().toISOString();
    insertAttempted = true;
    const { error } = await admin.from("daily_logs").insert({
      id: input.submissionId, project_id: project.id,
      author_id: null, subcontractor_id: null, is_site_guest: true, site_guest_name: input.name || null,
      kind: "post", status: "completed", started_at: at, ended_at: at,
      text: input.note || null, photo_storage_paths: paths,
      report_required: false, line_item_needs_review: false,
    });
    if (error) {
      // Re-read even for a transport error: the row may have committed before
      // the answer was lost. Only clean files we know are not attached to it.
      const existing = await findSaved(admin, input.submissionId);
      if (existing) {
        if (!existing.is_site_guest || existing.project_id !== project.id) {
          await cleanup();
          throw new GuestUploadError("Please start a new photo post.", 409);
        }
        const answer = isThisPost(existing, project.id);
        const { data: row, error: readError } = await admin.from("daily_logs").select("photo_storage_paths").eq("id", input.submissionId).single();
        if (!readError && !(row?.photo_storage_paths as string[] | undefined)?.some(path => paths.includes(path))) await cleanup();
        return answer;
      }
      await cleanup();
      throw new GuestUploadError(error.message?.includes("site_guest_hourly_limit")
        ? "This job has received a lot of photos. Please try again later."
        : "Couldn't save the post. Keep this page open and try again.", error.message?.includes("site_guest_hourly_limit") ? 429 : 503);
    }
    return { ok: true as const, logId: input.submissionId, duplicate: false, projectId: project.id };
  } catch (error) {
    // An uncertain database response may already reference these objects.
    // Keep them if its outcome could not be read back; never delete saved photos.
    if (!insertAttempted) await cleanup();
    throw error;
  }
}
