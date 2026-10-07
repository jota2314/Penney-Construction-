import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import { z } from "zod";

const report = z.object({
  stage: z.enum(["save", "restore"]),
  logId: z.string().uuid().optional(),
  /** What saved the photos after the full-size store failed. */
  fallback: z.enum(["shrunk", "memory"]).optional(),
  errorName: z.string().max(200),
  errorMessage: z.string().max(1000).optional(),
  photos: z.number().int().min(0).max(500),
  shrunk: z.number().int().min(0).max(500),
  bytes: z.number().min(0),
  usage: z.number().min(0).optional(),
  quota: z.number().min(0).optional(),
  userAgent: z.string().max(500),
});

/**
 * Records why a phone couldn't store daily-log photos before upload (full
 * storage vs. a browser that can't copy the picked files). The upload queue
 * falls back to memory either way; this only makes the cause visible, in
 * activity_log and the function logs.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user?.profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = report.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  }
  const { stage, logId, ...details } = parsed.data;

  console.error("[daily-log-photo] device storage failed", { profileId: user.profile.id, stage, logId, ...details });

  const { error } = await createAdminClient().from("activity_log").insert({
    user_id: user.profile.id,
    action: `daily_log_photo_${stage}_failed`,
    entity_type: logId ? "daily_log" : "profile",
    entity_id: logId ?? user.profile.id,
    details,
  });
  if (error) {
    console.error("[daily-log-photo] could not record storage failure", error.message);
  }

  return NextResponse.json({ ok: true });
}
