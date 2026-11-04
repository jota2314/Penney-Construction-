import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getRyanAvailability } from "@/lib/inquiries/calendar";
import { validAvailabilityDay } from "@/lib/inquiries/calendar-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-to-server only. The public website never receives this credential. */
export async function GET(request: Request) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supplied = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] || "";
  const headers = { "Cache-Control": "no-store, private", "Vary": "Authorization" };
  if (!key || !supplied || !timingSafeEqual(createHash("sha256").update(key).digest(), createHash("sha256").update(supplied).digest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  const from = new URL(request.url).searchParams.get("from");
  if (!validAvailabilityDay(from)) return NextResponse.json({ error: "Choose a date within the next 60 days." }, { status: 400, headers });
  const result = await getRyanAvailability(from);
  // Deliberately omit busy intervals, calendar links, IDs, titles and attendees.
  return NextResponse.json({ connected: result.connected, timeZone: result.timeZone,
    durationMinutes: result.durationMinutes, slots: result.slots,
    ...(result.connected ? {} : { message: "Available times could not be checked. You can still send your inquiry and we will arrange a visit with you." }),
  }, { headers });
}
