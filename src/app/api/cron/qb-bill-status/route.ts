import { NextResponse } from "next/server";
import { syncBillPaymentStatuses } from "@/lib/quickbooks/bill-status";
import { retryFailedQuickBooksPushes } from "@/lib/quickbooks/expenses";

export const maxDuration = 60;

/**
 * Every 6 hours: ask QuickBooks which of the app's pushed Bills got paid
 * over there (Nicole's Pay-bills flow) and flip those rows to paid/partial
 * in the app, so both books agree on A/P without anyone re-typing status.
 * Then retry recent pushes that failed, so a QBO hiccup doesn't strand a
 * receipt outside QuickBooks for good.
 */
export async function GET(request: Request) {
  const startedAt = Date.now();
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncBillPaymentStatuses();
  const retries = await retryFailedQuickBooksPushes(startedAt);
  return NextResponse.json({ ...result, retries });
}
