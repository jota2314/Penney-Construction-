import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";

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
    .select("id, photo_storage_paths")
    .eq("id", logId)
    .eq("author_id", userId)
    .maybeSingle();
  if (!log) {
    return NextResponse.json({ error: "Log not found" }, { status: 404 });
  }

  const path = `${logId}/${crypto.randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: "image/jpeg", upsert: false });
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const current: string[] = Array.isArray(log.photo_storage_paths)
    ? log.photo_storage_paths
    : [];
  const { error: updErr } = await supabase
    .from("daily_logs")
    .update({ photo_storage_paths: [...current, path] })
    .eq("id", logId)
    .eq("author_id", userId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path });
}
