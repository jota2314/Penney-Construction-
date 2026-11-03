import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;
/** Durable in-app notices: one initial and one overdue notice per inquiry/recipient. */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { data, error } = await createAdminClient().rpc("remind_website_inquiries");
    if (error) throw error;
    return NextResponse.json({ reminders: data, timestamp: new Date().toISOString() });
  } catch {
    console.error("[cron] Website inquiry reminders failed");
    return NextResponse.json({ error: "Inquiry reminders could not be completed." }, { status: 500 });
  }
}
