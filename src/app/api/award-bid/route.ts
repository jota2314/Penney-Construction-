import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { awardBid } from "@/lib/actions/bids";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { bidId, bidPackageId } = await request.json();
    if (!bidId || !bidPackageId) {
      return NextResponse.json({ error: "bidId and bidPackageId required" }, { status: 400 });
    }

    const result = await awardBid(bidId, bidPackageId);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("award-bid error:", error);
    return NextResponse.json({ error: "Failed to award bid" }, { status: 500 });
  }
}
