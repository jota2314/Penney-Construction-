import { NextRequest, NextResponse } from "next/server";
import { resolveSubAccess } from "@/lib/sub-portal/access";

export const runtime = "nodejs";
export const maxDuration = 30;

const BUCKET = "daily-log-photos";

/**
 * POST /api/sub-portal/logs/photo  (multipart: logId, file)
 * Attach one photo to a daily log the sub authored — same same-origin upload +
 * atomic append pattern as the crew route, authed by the portal cookie instead
 * of a profile.
 */
export async function POST(request: NextRequest) {
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
  if (typeof logId !== "string" || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing logId or file" }, { status: 400 });
  }

  // Only the sub's own logs — never someone else's post.
  const { data: log } = await supabase
    .from("daily_logs")
    .select("id")
    .eq("id", logId)
    .eq("subcontractor_id", subId)
    .maybeSingle();
  if (!log) return NextResponse.json({ error: "Log not found" }, { status: 404 });

  const path = `${logId}/${crypto.randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: "image/jpeg", upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: appended, error: updErr } = await supabase.rpc("append_daily_log_photo", {
    p_log_id: logId,
    p_path: path,
  });
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  if (!appended) return NextResponse.json({ error: "Log not found" }, { status: 404 });

  return NextResponse.json({ ok: true, path });
}
