import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureWeeklyShopMeeting } from "@/lib/crew/shop-meeting";

export const maxDuration = 30;

/**
 * Monday sweep: put the 7:00 AM shop meeting on every crew member's Today's
 * Work so they can clock into it with one tap instead of hunting for the Shop
 * job. Scheduled early (09:00 UTC — 5am ET in summer, 4am in winter) so the
 * card is waiting before anyone shows up, whatever daylight saving is doing.
 *
 * Idempotent: re-running the same Monday refreshes the assigned crew rather
 * than creating a second card. Auth via the shared CRON_SECRET, same as the
 * other crons.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  try {
    const result = await ensureWeeklyShopMeeting(supabase);
    return NextResponse.json({ timestamp: new Date().toISOString(), ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create shop meeting";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
