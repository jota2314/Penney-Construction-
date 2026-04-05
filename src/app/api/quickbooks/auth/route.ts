import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/quickbooks/auth";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const debug = searchParams.get("debug");
  const url = getAuthUrl();

  // Debug mode: show the URL instead of redirecting
  if (debug) {
    return NextResponse.json({
      authUrl: url,
      clientId: process.env.QUICKBOOKS_CLIENT_ID ? `${process.env.QUICKBOOKS_CLIENT_ID.substring(0, 8)}...` : "MISSING",
      appUrl: process.env.NEXT_PUBLIC_APP_URL || "NOT SET",
      redirectUri: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/quickbooks/callback`,
    });
  }

  return NextResponse.redirect(url);
}
