import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/quickbooks/auth";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const debug = searchParams.get("debug");
  const url = await getAuthUrl();

  if (debug) {
    return NextResponse.json({ authUrl: url });
  }

  return NextResponse.redirect(url);
}
