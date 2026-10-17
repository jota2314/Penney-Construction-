import { NextResponse } from "next/server";
import { runSubDigest } from "@/lib/subs/sub-digest";
import { etHour, todayET, weekdayOf } from "@/lib/sub-portal/et-day";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/** The digest goes out in the 5 PM ET hour (the cron fires at :30, so 5:30 PM). */
const DIGEST_HOUR_ET = 17;

/**
 * The 5:30 PM "Subs today" digest (plan §4.3): Jorge, plus each PM whose
 * jobs had a sub on site or scheduled, gets one in-app notice for the day,
 * pushed on insert. Never email.
 *
 * Vercel runs it hourly ("30 * * * *") and it acts only in the 5 PM hour
 * America/New_York, Monday to Saturday, so DST never moves it. The notice
 * id is deterministic per day, so a second run that day only rewrites the
 * text and pushes nobody.
 *
 * Auth via the shared CRON_SECRET, same as the other crons. With the secret:
 *   ?dry=1    any hour: build it and return every recipient's text, write nothing
 *   ?force=1  skip the hour guard and write (still the same per-day notice)
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  const force = params.get("force") === "1";
  const now = new Date();
  const day = todayET(now);
  const hour = etHour(now);

  if (!force && !dry && (hour !== DIGEST_HOUR_ET || weekdayOf(day) === 0)) {
    return NextResponse.json({ timestamp: now.toISOString(), skipped: "Runs at 5:30 PM ET, Monday to Saturday", day, hour });
  }

  try {
    const result = await runSubDigest(createAdminClient(), { now, dry });
    return NextResponse.json({ timestamp: now.toISOString(), ...result });
  } catch (err) {
    console.error("[cron] sub field digest failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
