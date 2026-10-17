import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSelectionSuggestions } from "@/lib/selections/email-suggestions";

export const maxDuration = 60;

// Job mail with picks, quotes, orders or deliveries becomes SUGGESTED
// selections-log updates for a person to approve. Never applied here.
//
// Its own tick, 7 minutes after fetch-emails stores and classifies the mail:
// reading a quote PDF takes ~18 s, and fetch-emails has ~10 s left once it
// has synced every mailbox, so PDFs never got read there. Stops starting
// new emails at 48 s so the response returns before the 60 s kill.
const TIME_BUDGET_MS = 48_000;

export async function GET(request: Request) {
  const startedAt = Date.now();
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runSelectionSuggestions(createAdminClient(), { deadlineMs: startedAt + TIME_BUDGET_MS });
    return NextResponse.json({ timestamp: new Date().toISOString(), ...result });
  } catch (err) {
    console.error("[cron] selection suggestions failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
