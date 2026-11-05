import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidateSchedule } from "@/lib/schedule/revalidate";
import { GUEST_BODY_BYTES, GuestUploadError, parseGuestPhotoForm, saveGuestPhotos } from "@/lib/site-qr/guest-upload";

export const runtime = "nodejs";
export const maxDuration = 60;

const attempts = new Map<string, { count: number; until: number }>();
function allowAttempt(request: NextRequest): boolean {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const previous = attempts.get(ip);
  if (previous) { previous.count++; return previous.count <= 30; }
  if (attempts.size >= 5000) return false;
  attempts.set(ip, { count: 1, until: now + 10 * 60_000 });
  return true;
}

async function readGuestForm(request: Request): Promise<FormData> {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new GuestUploadError("Choose photos before posting.");
  if (Number(request.headers.get("content-length")) > GUEST_BODY_BYTES) throw new GuestUploadError("Please choose fewer photos.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new GuestUploadError("Choose photos before posting.");
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > GUEST_BODY_BYTES) { await reader.cancel(); throw new GuestUploadError("Please choose fewer photos.", 413); }
      chunks.push(Buffer.from(value));
    }
    return await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
  } catch (error) {
    if (error instanceof GuestUploadError) throw error;
    throw new GuestUploadError("Couldn't read the photos. Please select them again.");
  } finally { reader.releaseLock(); }
}

/** The secret printed job code is the capability; this endpoint requires no account or PIN. */
export async function POST(request: NextRequest) {
  const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) {
    return json({ error: "Please scan the job QR and post from that page." }, 403);
  }
  if (!allowAttempt(request)) return json({ error: "Please wait a few minutes, then try again." }, 429);
  try {
    const input = parseGuestPhotoForm(await readGuestForm(request));
    const result = await saveGuestPhotos(createAdminClient(), input);
    // A cache invalidation failure must never turn a saved post into an error.
    try { revalidateSchedule(result.projectId); } catch (error) { console.error("[site-photos] Revalidation failed", error); }
    return json({ ok: true, logId: result.logId, duplicate: result.duplicate });
  } catch (error) {
    if (error instanceof GuestUploadError) return json({ error: error.message }, error.status);
    console.error("[site-photos] Post failed", error);
    return json({ error: "Couldn't post the photos. Keep this page open and try again." }, 503);
  }
}
