import { NextResponse } from "next/server";
import { sendNewWebsiteInquiryAlerts } from "@/lib/inquiries/new-inquiry-alert";

export const maxDuration = 30;
/** Every minute: email each new website inquiry to Jorge, Ryan and Shannon once. */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendNewWebsiteInquiryAlerts();
  return NextResponse.json({ ...result, timestamp: new Date().toISOString() }, { status: result.error ? 500 : 200 });
}
