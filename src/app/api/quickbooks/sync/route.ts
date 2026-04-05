import { NextResponse } from "next/server";
import { syncQuickBooks } from "@/lib/quickbooks/sync";

export async function POST() {
  try {
    const result = await syncQuickBooks();
    return NextResponse.json({ success: true, result });
  } catch (e) {
    console.error("QB sync error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 }
    );
  }
}
