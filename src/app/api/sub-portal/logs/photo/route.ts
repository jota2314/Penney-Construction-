import { after, NextRequest, NextResponse } from "next/server";
import { resolveSubAccess } from "@/lib/sub-portal/access";
import { refuseStaffBrowser } from "@/lib/sub-portal/staff-guard";
import { etDate, todayET } from "@/lib/sub-portal/et-day";
import { notifySubField } from "@/lib/notifications/sub-field-notify";
import { isUuid, recordVisit } from "../capture";

export const runtime = "nodejs";
export const maxDuration = 30;

const BUCKET = "daily-log-photos";
/** The bucket's own limit; the phone shrinks photos far below it. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/sub-portal/logs/photo  (multipart: logId, uploadId, file)
 *
 * Attach one photo to a post or shift of his own, the same way the crew
 * route does (/api/crew/daily-log-photo): the phone uploads to our own
 * origin, never straight to storage, and the path is appended under the
 * row lock (append_daily_log_photo), so parallel uploads can't clobber
 * each other.
 *
 * Idempotent by upload ID. The photo lands at {logId}/{uploadId}.jpg; a
 * retry (lost answer, app killed mid-upload) finds the photo already on the
 * log and answers ok, or finds the stored file and only re-attaches it. Each
 * photo is counted once on today's visit. Old app shells send no uploadId
 * and get a fresh one, as before.
 */
export async function POST(request: NextRequest) {
  const refused = await refuseStaffBrowser(request);
  if (refused) return refused;
  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase, subId } = access;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const logId = form.get("logId");
  const file = form.get("file");
  if (!isUuid(logId) || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing logId or file" }, { status: 400 });
  }
  const rawUploadId = form.get("uploadId");
  const uploadId = rawUploadId === null || rawUploadId === "" ? crypto.randomUUID() : rawUploadId;
  if (!isUuid(uploadId)) return NextResponse.json({ error: "Invalid photo upload ID" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "That photo is empty" }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That photo is too big to send. Pick it again." }, { status: 413 });
  }

  // Only his own posts and shifts, never someone else's.
  const { data: log } = await supabase
    .from("daily_logs")
    .select("id, project_id, started_at, photo_storage_paths")
    .eq("id", logId)
    .eq("subcontractor_id", subId)
    .maybeSingle();
  if (!log) return NextResponse.json({ error: "Log not found" }, { status: 404 });

  const path = `${logId}/${uploadId}.jpg`;
  // Already on the log: a retry whose first answer got lost.
  if (((log.photo_storage_paths as string[] | null) ?? []).includes(path)) {
    return NextResponse.json({ ok: true, path });
  }

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: "image/jpeg", upsert: false });
  if (upErr) {
    // A lost response or app restart may retry a photo already stored.
    // Confirm the exact object exists, then retry the idempotent attachment.
    const { data: existing, error: listError } = await supabase.storage
      .from(BUCKET)
      .list(logId, { search: `${uploadId}.jpg`, limit: 10 });
    if (listError || !existing?.some((object) => object.name === `${uploadId}.jpg`)) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  const { data: appended, error: updErr } = await supabase.rpc("append_daily_log_photo", {
    p_log_id: logId,
    p_path: path,
  });
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  if (!appended) return NextResponse.json({ error: "Log not found" }, { status: 404 });

  // Count it on today's visit only when the post is today's: photos from
  // yesterday's post that finish this morning don't put him on site today.
  const projectId = log.project_id as string | null;
  if (projectId && etDate(log.started_at as string) === todayET()) {
    await recordVisit(supabase, { projectId, subId, source: "post", photos: 1 });
    after(() => notifySubField({ subId, projectId, event: "posted" }));
  }

  return NextResponse.json({ ok: true, path });
}
