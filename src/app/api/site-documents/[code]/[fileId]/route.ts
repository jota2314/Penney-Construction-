import { NextRequest, NextResponse } from "next/server";
import { GuestDocumentsError, getGuestJobDocumentUrl } from "@/lib/site-qr/guest-documents";

export const runtime = "nodejs";
export const maxDuration = 30;

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

/** Only code-scoped eligible files; no bucket, storage path or project input. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string; fileId: string }> }) {
  if (request.headers.has("next-action")) return NextResponse.json({ error: "Unsupported document request." }, { status: 400, headers });
  try {
    const { code, fileId } = await params;
    const url = await getGuestJobDocumentUrl(code, fileId);
    return new NextResponse(null, { status: 307, headers: { ...headers, Location: url } });
  } catch (error) {
    const status = error instanceof GuestDocumentsError ? error.status : 503;
    return NextResponse.json({ error: status === 404 ? "This job document isn't available." : "Job documents couldn't load. Please try again." }, { status, headers });
  }
}
