import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;
/**
 * Every 10 minutes: move website inquiries forward on their own. A homeowner
 * reply makes it a Lead; its project in estimating, proposal sent or
 * contracted makes it Estimating, Proposal sent or Won.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await createAdminClient().rpc("advance_website_inquiries");
  if (error) {
    console.error("[cron] Website inquiry stages could not be updated");
    return NextResponse.json({ error: "Inquiry stages could not be updated." }, { status: 500 });
  }
  return NextResponse.json({ moved: data, timestamp: new Date().toISOString() });
}
