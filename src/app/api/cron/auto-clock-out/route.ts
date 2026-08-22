import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoCloseStaleLogs } from "@/lib/crew/auto-clock-out";
import { closeStaleMeetingShifts } from "@/lib/crew/shop-meeting";

export const maxDuration = 30;

/**
 * Hourly sweep: close any field shift left open past the 12h max so a forgotten
 * clock-out can't run the timer for days. Caps the shift, flags it, and
 * push-notifies the worker. Auth via the shared CRON_SECRET, same as the other
 * crons.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const result = await autoCloseStaleLogs(supabase);
  // Same pass caps any Monday shop meeting that never handed off to a job.
  const meetings = await closeStaleMeetingShifts(supabase);

  return NextResponse.json({ timestamp: new Date().toISOString(), ...result, meetings });
}
