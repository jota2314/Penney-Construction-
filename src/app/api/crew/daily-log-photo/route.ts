import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { z } from "zod";

const BUCKET = "daily-log-photos";

export const maxDuration = 30;

/**
 * Upload one daily-log photo through our own (same-origin) server, instead of
 * the browser going straight to Supabase storage — that cross-origin upload
 * stalls on some field devices/connections, leaving photos silently unattached.
 * The client shrinks the image first, so the body stays well under limits.
 *
 * Verifies the caller owns the log, stores the file, and appends its path.
 */
export async function POST(request: Request) {
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const logId = form.get("logId");
  const file = form.get("file");
  if (typeof logId !== "string" || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing logId or file" }, { status: 400 });
  }

  const supabase = await createClient();

  // Only the log's author may attach photos to it.
  const { data: log } = await supabase
    .from("daily_logs")
    .select("id")
    .eq("id", logId)
    .eq("author_id", userId)
    .maybeSingle();
  if (!log) {
    return NextResponse.json({ error: "Log not found" }, { status: 404 });
  }

  const rawUploadId = form.get("uploadId");
  const uploadId = rawUploadId === null ? crypto.randomUUID() : rawUploadId;
  if (!z.string().uuid().safeParse(uploadId).success) return NextResponse.json({ error: "Invalid photo upload ID" }, { status: 400 });
  const path = `${logId}/${uploadId}.jpg`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: "image/jpeg", upsert: false });
  if (upErr) {
    // A lost response or app restart may retry a photo already stored.
    // Confirm the exact object exists, then retry the idempotent attachment.
    const { data: existing, error: listError } = await supabase.storage.from(BUCKET)
      .list(logId, { search: `${uploadId}.jpg`, limit: 10 });
    if (listError || !existing?.some(object => object.name === `${uploadId}.jpg`)) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  // Atomic append under the row lock — parallel photo uploads on the same
  // log must not clobber each other's paths (they did when this was a
  // read-modify-write on photo_storage_paths).
  const { data: appended, error: updErr } = await supabase.rpc("append_daily_log_photo", {
    p_log_id: logId,
    p_path: path,
  });
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }
  if (!appended) {
    return NextResponse.json({ error: "Log not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, path });
}
