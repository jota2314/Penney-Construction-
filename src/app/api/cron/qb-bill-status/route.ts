import { NextResponse } from "next/server";
import { syncBillPaymentStatuses } from "@/lib/quickbooks/bill-status";

export const maxDuration = 60;

/**
 * Every 6 hours: ask QuickBooks which of the app's pushed Bills got paid
 * over there (Nicole's Pay-bills flow) and flip those rows to paid/partial
 * in the app, so both books agree on A/P without anyone re-typing status.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncBillPaymentStatuses();
  return NextResponse.json(result);
}
