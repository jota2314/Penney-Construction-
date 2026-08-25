import { type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioConfig } from "@/lib/twilio/twilio";

export const dynamic = "force-dynamic";

/**
 * Authenticated proxy for voicemail audio. Twilio recording URLs may
 * require the account credentials (when "Enforce HTTP Auth on media" is
 * on), so the app streams the MP3 itself instead of linking out.
 * GET /api/twilio/recording-audio?id=<phone_calls.id>
 */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("phone_calls")
    .select("recording_url")
    .eq("id", id)
    .maybeSingle();

  const recordingUrl = (row as { recording_url: string | null } | null)
    ?.recording_url;
  if (!recordingUrl) return new Response("Not found", { status: 404 });

  const config = await getTwilioConfig();
  if (!config.accountSid || !config.authToken) {
    return new Response("Twilio not configured", { status: 503 });
  }

  const audio = await fetch(`${recordingUrl}.mp3`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
    },
  });
  if (!audio.ok || !audio.body) {
    return new Response("Recording unavailable", { status: 502 });
  }

  return new Response(audio.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
    },
  });
}
